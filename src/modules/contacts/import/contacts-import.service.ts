import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { formatContactId, toPayTermType } from '../contacts.constants';
import {
  COLUMN_COUNT,
  CONTACT_TYPE_MAP,
  IMPORT_COLUMNS,
  TEMPLATE_SAMPLE_ROW,
  type ImportColumn,
} from './contacts-import.columns';

/**
 * Guardrails GOURI has none of: `postImportContacts` accepts any upload of any size or type — the
 * only filter is a client-side `accept=".xls"` on the file input, which any curl bypasses.
 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5_000;

export interface ImportIssue {
  /** The row number the user sees in their spreadsheet (header = 1, so data starts at 2). */
  row: number;
  column: string;
  message: string;
}

export interface ImportReport {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** First few parsed contacts, so the user can eyeball the mapping before committing. */
  preview: { row: number; type: string; name: string; mobile: string; contactId: string }[];
  /** Null on a dry run; the number written on a real import. */
  imported: number | null;
}

interface ParsedRow {
  rowNo: number;
  values: Record<string, string>;
}

type ContactCreateRow = {
  businessId: number;
  createdBy: number;
  type: string;
  name: string;
  contactId: string;
  mobile: string;
  [key: string]: unknown;
};

const blank = (v: string): string | null => (v === '' ? null : v);

@Injectable()
export class ContactsImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The spec, for the on-screen instructions table. */
  columns(): ImportColumn[] {
    return IMPORT_COLUMNS;
  }

  // ── template ───────────────────────────────────────────
  /**
   * Generated, never stored. GOURI ships a static `.xls` (BIFF 2003) from 2020; we emit the same 27
   * headers as a modern .xlsx/.csv so there is exactly one place the spec can live.
   */
  async buildTemplate(format: 'xlsx' | 'csv'): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Contacts');
    ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
    ws.addRow(TEMPLATE_SAMPLE_ROW);

    if (format === 'csv') return Buffer.from(await wb.csv.writeBuffer());

    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col, i) => {
      col.width = Math.max(14, IMPORT_COLUMNS[i].header.length + 2);
    });
    // The sample row is illustrative — it must not be mistaken for data to keep.
    ws.getRow(2).font = { italic: true, color: { argb: 'FF888888' } };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── parse ──────────────────────────────────────────────
  private cellText(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10); // a real Excel date cell → YYYY-MM-DD
    if (typeof v === 'object') {
      // Formula cells carry their computed result; rich text carries runs.
      if ('result' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '').trim();
      if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('').trim();
      if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? '').trim();
      return '';
    }
    return String(v).trim();
  }

  private async readRows(file: Express.Multer.File): Promise<ParsedRow[]> {
    const isCsv = /\.csv$/i.test(file.originalname);
    const wb = new ExcelJS.Workbook();
    try {
      if (isCsv) await wb.csv.read(Readable.from(file.buffer));
      // exceljs types its own Buffer; @types/node's generic Buffer<ArrayBufferLike> is not assignable.
      else await wb.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Could not read that file. Please upload the template as .xlsx or .csv.');
    }

    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The file has no sheets');

    const rows: ParsedRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // header — GOURI splices it off the same way

      const cells: string[] = [];
      for (let i = 1; i <= COLUMN_COUNT; i++) cells.push(this.cellText(row.getCell(i)));
      if (cells.every((c) => c === '')) return; // blank spacer row

      const values: Record<string, string> = {};
      IMPORT_COLUMNS.forEach((col, i) => {
        values[col.key] = cells[i] ?? '';
      });
      // rowNumber IS the spreadsheet row. GOURI reports `$key+1` computed after splicing the
      // header, so every one of its error messages points one row too high.
      rows.push({ rowNo: rowNumber, values });
    });

    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`That file has ${rows.length} rows. Please import at most ${MAX_ROWS} at a time.`);
    }
    return rows;
  }

  // ── validate ───────────────────────────────────────────
  private async validate(businessId: number, userId: number, rows: ParsedRow[]) {
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const contactRows: ContactCreateRow[] = [];
    const needsGeneratedId: number[] = [];

    const header = (key: string) => IMPORT_COLUMNS.find((c) => c.key === key)!.header;
    const err = (row: number, key: string, message: string) => errors.push({ row, column: header(key), message });
    const warn = (row: number, key: string, message: string) => warnings.push({ row, column: header(key), message });

    // One query instead of GOURI's per-row lookup.
    const wanted = rows.map((r) => r.values.contact_id).filter(Boolean);
    const taken = new Set(
      wanted.length
        ? (
            await this.prisma.contact.findMany({
              where: { businessId, contactId: { in: wanted } },
              select: { contactId: true },
            })
          ).map((c) => c.contactId as string)
        : [],
    );
    const seenInFile = new Map<string, number>();

    for (const { rowNo, values } of rows) {
      const before = errors.length;

      // 1 — contact type. GOURI's `in_array($type, [1,2,3])` is a loose compare against ints, so on
      // PHP 7 the word "customer" passed and silently stored type=null. Only the digits are valid.
      const type = CONTACT_TYPE_MAP[values.type];
      if (!values.type) err(rowNo, 'type', 'Contact type is required (1 = Customer, 2 = Supplier, 3 = Both)');
      else if (!type) err(rowNo, 'type', `"${values.type}" is not a valid contact type — use 1, 2 or 3`);

      const isSupplier = type === 'supplier' || type === 'both';
      const isCustomer = type === 'customer' || type === 'both';

      if (!values.first_name) err(rowNo, 'first_name', 'First name is required');
      if (!values.mobile) err(rowNo, 'mobile', 'Mobile is required');

      // 6 — GOURI's instructions call this required for suppliers but its code never checks. Warn
      // rather than reject, so a file that imports into GOURI also imports here.
      if (isSupplier && !values.supplier_business_name) {
        warn(rowNo, 'supplier_business_name', 'Blank for a supplier — the contact will be listed under the person’s name');
      }

      // 10 / 11 — required for suppliers only (ContactController.php:1107-1123)
      let payTermNumber: number | null = null;
      if (isSupplier && !values.pay_term_number) err(rowNo, 'pay_term_number', 'Pay term is required for a Supplier or Both');
      else if (values.pay_term_number) {
        const n = Number(values.pay_term_number);
        if (!Number.isInteger(n) || n < 0) err(rowNo, 'pay_term_number', `"${values.pay_term_number}" is not a whole number`);
        else payTermNumber = n;
      }

      let payTermType: string | null = null;
      const rawTerm = values.pay_term_type.toLowerCase();
      if (isSupplier && !rawTerm) err(rowNo, 'pay_term_type', 'Pay term period is required for a Supplier or Both');
      else if (rawTerm && rawTerm !== 'days' && rawTerm !== 'months') {
        err(rowNo, 'pay_term_type', `"${values.pay_term_type}" is not valid — use days or months`);
      } else if (rawTerm) payTermType = rawTerm;

      // 12 — GOURI stores credit limit for customer/both only, and never says so on screen.
      let creditLimit: number | null = null;
      if (values.credit_limit) {
        const n = Number(values.credit_limit);
        if (Number.isNaN(n) || n < 0) err(rowNo, 'credit_limit', `"${values.credit_limit}" is not a valid amount`);
        else if (!isCustomer) warn(rowNo, 'credit_limit', 'Ignored — credit limit applies to Customer / Both only');
        else creditLimit = n;
      }

      // 13 — format only, and only when present (ContactController.php:1157-1165)
      if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
        err(rowNo, 'email', `"${values.email}" is not a valid email address`);
      }

      // 7 — GOURI checks the DB only, so two rows in the SAME file can share a contact ID and both insert.
      const contactId = values.contact_id;
      if (contactId) {
        if (taken.has(contactId)) err(rowNo, 'contact_id', `"${contactId}" already exists`);
        else if (seenInFile.has(contactId)) {
          err(rowNo, 'contact_id', `"${contactId}" is used twice in this file (also row ${seenInFile.get(contactId)})`);
        } else seenInFile.set(contactId, rowNo);
      }

      // 23 — GOURI documents "Format Y-m-d" and validates nothing; an Excel date cell reaches the
      // date column as a numeric serial (e.g. 33604).
      let dob: Date | null = null;
      if (values.dob) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(values.dob);
        const d = m ? new Date(`${values.dob}T00:00:00Z`) : null;
        if (!d || Number.isNaN(d.getTime())) err(rowNo, 'dob', `"${values.dob}" is not a valid date — use YYYY-MM-DD`);
        else dob = d;
      }

      // 9 — parsed and validated, but deliberately NOT imported: GOURI writes it to `transactions`
      // (type=opening_balance), a table this port does not have yet.
      if (values.opening_balance) {
        const n = Number(values.opening_balance);
        if (Number.isNaN(n)) err(rowNo, 'opening_balance', `"${values.opening_balance}" is not a valid amount`);
        else if (n !== 0) {
          warn(rowNo, 'opening_balance', 'Not imported yet — opening balances arrive with the transactions module');
        }
      }

      if (errors.length > before) continue; // row is bad; keep checking the rest (GOURI stops at the first)

      // GOURI implodes prefix+first+middle+last unfiltered, so blanks leave double/leading spaces.
      const name = [values.prefix, values.first_name, values.middle_name, values.last_name]
        .filter(Boolean)
        .join(' ');

      if (!contactId) needsGeneratedId.push(contactRows.length);
      contactRows.push({
        businessId,
        createdBy: userId,
        type: type as string,
        name,
        contactId,
        mobile: values.mobile,
        prefix: blank(values.prefix),
        firstName: blank(values.first_name),
        middleName: blank(values.middle_name),
        lastName: blank(values.last_name),
        supplierBusinessName: blank(values.supplier_business_name),
        taxNumber: blank(values.tax_number),
        payTermNumber,
        payTermType: toPayTermType(payTermType), // the Prisma enum is DAYS/MONTHS, mapped to the lowercase DB values

        creditLimit,
        email: blank(values.email),
        alternateNumber: blank(values.alternate_number),
        landline: blank(values.landline),
        city: blank(values.city),
        state: blank(values.state),
        country: blank(values.country),
        addressLine1: blank(values.address_line_1),
        addressLine2: blank(values.address_line_2),
        zipCode: blank(values.zip_code),
        dob,
        customField1: blank(values.custom_field1),
        customField2: blank(values.custom_field2),
        customField3: blank(values.custom_field3),
        customField4: blank(values.custom_field4),
        contactStatus: 'active',
        createdAt: new Date(),
      });
    }

    return { errors, warnings, contactRows, needsGeneratedId };
  }

  // ── import ─────────────────────────────────────────────
  /**
   * Parse → validate → (optionally) commit. The uploaded file is held in memory for this call and
   * then dropped: it is a transport, not a record. GOURI does the same (`Excel::toArray` on the PHP
   * temp upload, never stored) — what it lacks is any record of the import having happened, which
   * our activity trail provides.
   */
  async import(
    businessId: number,
    userId: number,
    file: Express.Multer.File,
    dryRun: boolean,
  ): Promise<ImportReport> {
    if (!file) throw new BadRequestException('Please choose a file to import');
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) {
      throw new BadRequestException('Unsupported file type — upload the template as .xlsx or .csv');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB`);
    }

    const rows = await this.readRows(file);
    if (rows.length === 0) throw new BadRequestException('That file has no data rows — only the header');

    const { errors, warnings, contactRows, needsGeneratedId } = await this.validate(businessId, userId, rows);

    const report: ImportReport = {
      totalRows: rows.length,
      validRows: contactRows.length,
      errorRows: new Set(errors.map((e) => e.row)).size,
      errors,
      warnings,
      preview: [],
      imported: null,
    };

    // Nothing is written unless every row is clean — GOURI's all-or-nothing rule, except it stops at
    // the first bad row, so a file with 50 problems takes 50 upload attempts to discover them all.
    if (errors.length > 0 || dryRun) {
      report.preview = contactRows.slice(0, 10).map((c, i) => ({
        row: rows[i]?.rowNo ?? 0,
        type: c.type,
        name: c.name,
        mobile: c.mobile,
        contactId: c.contactId || '(auto)',
      }));
      return report;
    }

    // Reserve every auto contact_id in ONE increment. GOURI calls setAndGetReferenceCount per row —
    // a SELECT + UPDATE each, holding a write lock on reference_counts for the whole import.
    if (needsGeneratedId.length > 0) {
      const start = await this.reserveContactIds(businessId, needsGeneratedId.length);
      const business = await this.prisma.business.findUnique({
        where: { id: businessId },
        select: { refNoPrefixes: true },
      });
      const prefix = ((business?.refNoPrefixes ?? {}) as Record<string, string>).contacts ?? '';
      needsGeneratedId.forEach((rowIndex, i) => {
        contactRows[rowIndex].contactId = formatContactId(prefix, start + i);
      });
    }

    // One statement for the whole file: on a serverless DB, a per-row insert would be one network
    // round-trip per contact.
    const { count } = await this.prisma.contact.createMany({ data: contactRows as never });
    report.imported = count;

    this.audit.log({
      action: 'imported',
      subjectType: 'Contact',
      description: `Imported ${count} contact${count === 1 ? '' : 's'} from ${file.originalname}`,
      properties: { count, fileName: file.originalname, rows: rows.length, warnings: warnings.length },
    });
    return report;
  }

  /** Bump the counter by `n` and return the FIRST reserved value. */
  private async reserveContactIds(businessId: number, n: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.referenceCount.findFirst({ where: { businessId, refType: 'contacts' } });
      if (!existing) {
        await tx.referenceCount.create({ data: { businessId, refType: 'contacts', refCount: n } });
        return 1;
      }
      const updated = await tx.referenceCount.update({
        where: { id: existing.id },
        data: { refCount: existing.refCount + n },
      });
      return updated.refCount - n + 1;
    });
  }
}
