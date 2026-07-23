import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { StockService } from '../../../common/services/stock.service';
import { ReferenceNumberService } from '../../../common/services/reference-number.service';
import { round4 } from '../../purchases/purchase.calc';
import { OPENING_STOCK_IMPORT_COLUMNS } from './products-import.columns';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;
const COLUMN_COUNT = OPENING_STOCK_IMPORT_COLUMNS.length;

export interface ImportIssue { row: number; column: string; message: string }
interface StockLine {
  rowNo: number;
  productId: number;
  productVariationId: number;
  variationId: number;
  locationId: number;
  quantity: number;
  unitCost: number;
  taxAmount: number;
  lotNumber: string | null;
  expDate: Date | null;
}

/**
 * Import Opening Stock — the sell-side of the catalogue imports. Each row adds a lot to a variation
 * at a location, writing an `opening_stock` transaction + line and posting the quantity through
 * StockService (the one writer of stock). GOURI's version leaks server paths on error and silently
 * double-counts on re-import; here errors are clean and every row is validated before any write.
 */
@Injectable()
export class OpeningStockImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly refs: ReferenceNumberService,
  ) {}

  columns() {
    return OPENING_STOCK_IMPORT_COLUMNS;
  }

  async buildTemplate(format: 'xlsx' | 'csv'): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Opening stock');
    ws.addRow(OPENING_STOCK_IMPORT_COLUMNS.map((c) => c.header));
    ws.getRow(1).font = { bold: true };
    if (format === 'csv') return Buffer.from(await wb.csv.writeBuffer());
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private cellText(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('').trim();
      if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? '').trim();
      if ('result' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '').trim();
      return '';
    }
    return String(v).trim();
  }

  private async readRows(file: Express.Multer.File): Promise<{ rowNo: number; values: Record<string, string> }[]> {
    const isCsv = /\.csv$/i.test(file.originalname);
    const wb = new ExcelJS.Workbook();
    try {
      if (isCsv) await wb.csv.read(Readable.from(file.buffer));
      else await wb.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Could not read that file. Please upload the template as .xlsx or .csv.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The file has no sheets');
    const rows: { rowNo: number; values: Record<string, string> }[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells: string[] = [];
      for (let i = 1; i <= COLUMN_COUNT; i++) cells.push(this.cellText(row.getCell(i)));
      if (cells.every((c) => c === '')) return;
      const values: Record<string, string> = {};
      OPENING_STOCK_IMPORT_COLUMNS.forEach((col, i) => (values[col.key] = cells[i] ?? ''));
      rows.push({ rowNo: rowNumber, values });
    });
    if (rows.length > MAX_ROWS) throw new BadRequestException(`That file has ${rows.length} rows. Please import at most ${MAX_ROWS} at a time.`);
    return rows;
  }

  async import(businessId: number, userId: number, file: Express.Multer.File, dryRun: boolean) {
    if (!file) throw new BadRequestException('No file was uploaded');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('That file is larger than 5MB');
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new BadRequestException('Please upload the template as .xlsx or .csv');

    const rows = await this.readRows(file);
    if (rows.length === 0) throw new BadRequestException('The file has no data rows');

    const errors: ImportIssue[] = [];
    const header = (key: string) => OPENING_STOCK_IMPORT_COLUMNS.find((c) => c.key === key)!.header;
    const err = (row: number, key: string, message: string) => errors.push({ row, column: header(key), message });

    const locations = await this.prisma.businessLocation.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true } });
    const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));
    const firstLocation = locations.length ? [...locations].sort((a, b) => a.id - b.id)[0].id : null;

    const lines: StockLine[] = [];
    for (const { rowNo, values: v } of rows) {
      const before = errors.length;
      const sku = v.sku.trim();
      if (!sku) { err(rowNo, 'sku', 'Product SKU is required'); continue; }

      const variation = await this.prisma.variation.findFirst({
        where: { subSku: sku, deletedAt: null, product: { businessId } },
        select: { id: true, productId: true, productVariationId: true, product: { select: { enableStock: true, taxRateId: true } } },
      });
      if (!variation) { err(rowNo, 'sku', `No product with SKU "${sku}" was found`); continue; }
      if (!variation.product.enableStock) err(rowNo, 'sku', `"${sku}" does not track stock — enable it first`);

      let locationId = firstLocation;
      if (v.location.trim()) {
        locationId = locByName.get(v.location.trim().toLowerCase()) ?? null;
        if (!locationId) err(rowNo, 'location', `Location "${v.location}" was not found`);
      }
      if (!locationId) err(rowNo, 'location', 'No business location to import into');

      const quantity = parseFloat(v.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) err(rowNo, 'quantity', 'Quantity must be a number greater than zero');
      const unitCost = parseFloat(v.unit_cost);
      if (!Number.isFinite(unitCost) || unitCost < 0) err(rowNo, 'unit_cost', 'Unit cost must be a valid number');

      let expDate: Date | null = null;
      if (v.expiry_date.trim()) {
        const d = new Date(v.expiry_date.trim());
        if (Number.isNaN(d.getTime())) err(rowNo, 'expiry_date', `"${v.expiry_date}" is not a valid date — use YYYY-MM-DD`);
        else expDate = d;
      }

      const taxAmount = variation.product.taxRateId
        ? Number((await this.prisma.taxRate.findUnique({ where: { id: variation.product.taxRateId }, select: { amount: true } }))?.amount ?? 0)
        : 0;

      if (errors.length > before) continue;
      lines.push({
        rowNo,
        productId: variation.productId,
        productVariationId: variation.productVariationId,
        variationId: variation.id,
        locationId: locationId!,
        quantity: round4(quantity),
        unitCost: round4(unitCost),
        taxAmount,
        lotNumber: v.lot_number.trim() || null,
        expDate,
      });
    }

    const report = { totalRows: rows.length, validRows: lines.length, imported: 0, errors, warnings: [] as ImportIssue[] };
    if (dryRun || errors.length > 0) return report;

    // One opening_stock transaction per (location) carrying all its lines, then post the stock.
    await this.prisma.$transaction(async (tx) => {
      const byLocation = new Map<number, StockLine[]>();
      for (const l of lines) {
        const arr = byLocation.get(l.locationId) ?? [];
        arr.push(l);
        byLocation.set(l.locationId, arr);
      }
      for (const [locationId, group] of byLocation) {
        const refNo = await this.refs.generate(businessId, 'opening_stock', 'OS');
        const finalTotal = round4(group.reduce((s, l) => s + l.quantity * (l.unitCost + (l.unitCost * l.taxAmount) / 100), 0));
        await tx.transaction.create({
          data: {
            businessId,
            locationId,
            type: 'OPENING_STOCK',
            status: 'RECEIVED',
            refNo,
            transactionDate: new Date(),
            lineSubtotal: finalTotal,
            finalTotal,
            paymentStatus: 'PAID',
            createdBy: userId,
            purchaseLines: {
              create: group.map((l) => {
                const itemTax = round4((l.unitCost * l.taxAmount) / 100);
                return {
                  productId: l.productId,
                  variationId: l.variationId,
                  quantity: l.quantity,
                  ppWithoutDiscount: l.unitCost,
                  purchasePrice: l.unitCost,
                  itemTax,
                  purchasePriceIncTax: round4(l.unitCost + itemTax),
                  lotNumber: l.lotNumber,
                  expDate: l.expDate,
                };
              }),
            },
          },
        });
        await this.stock.moveMany(
          tx,
          group.map((l) => ({ locationId, productId: l.productId, productVariationId: l.productVariationId, variationId: l.variationId, delta: l.quantity })),
        );
      }
    }, { timeout: 30000 });

    report.imported = lines.length;
    this.audit.log({
      action: 'imported',
      subjectType: 'Product',
      businessId,
      description: `Imported opening stock for ${lines.length} line${lines.length === 1 ? '' : 's'} from ${file.originalname}`,
      properties: { attributes: { count: lines.length, fileName: file.originalname, rows: rows.length } },
    });
    return report;
  }
}
