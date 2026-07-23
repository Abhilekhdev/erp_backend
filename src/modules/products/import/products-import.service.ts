import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { OpeningStockService } from '../../opening-stock/opening-stock.service';
import { round4 } from '../../purchases/purchase.calc';
import { ProductsService } from '../products.service';
import { PRODUCT_IMPORT_COLUMNS } from './products-import.columns';
import type { SaveProductDto } from '../dto/save-product.dto';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5_000;
const COLUMN_COUNT = PRODUCT_IMPORT_COLUMNS.length;
const BARCODES = new Set(['C128', 'C39', 'EAN13', 'EAN8', 'UPCA', 'UPCE']);

interface ParsedRow {
  rowNo: number;
  values: Record<string, string>;
}
export interface ImportIssue {
  row: number;
  column: string;
  message: string;
}
interface RowPlan {
  rowNo: number;
  name: string;
  type: 'single' | 'variable';
  dto: SaveProductDto;
  brandName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  openingStock: { locationName: string | null; lots: { variationIndex: number; quantity: number; unitCost: number; expDate: string | null }[] } | null;
}

const num = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const pipe = (v: string): string[] => (v ? v.split('|').map((x) => x.trim()) : []);

/**
 * Import Products — the bulk catalogue loader, mirroring `contacts-import` in shape and reusing the
 * tested `ProductsService.create` / `OpeningStockService` so none of the variation/price/stock logic
 * is duplicated. Fixes carried over the GOURI original: ALL rows are validated before anything is
 * written (GOURI stops at the first bad row), image cells are stored as-is (GOURI `file_get_content`s
 * a URL — an SSRF), a sub-category with no category is a clear error (GOURI hits an undefined var),
 * and opening stock is set exactly once per product (GOURI's opening-stock import double-counts).
 */
@Injectable()
export class ProductsImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    private readonly openingStock: OpeningStockService,
  ) {}

  columns() {
    return PRODUCT_IMPORT_COLUMNS;
  }

  async buildTemplate(format: 'xlsx' | 'csv'): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(PRODUCT_IMPORT_COLUMNS.map((c) => c.header));
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

  private async readRows(file: Express.Multer.File): Promise<ParsedRow[]> {
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

    const rows: ParsedRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells: string[] = [];
      for (let i = 1; i <= COLUMN_COUNT; i++) cells.push(this.cellText(row.getCell(i)));
      if (cells.every((c) => c === '')) return;
      const values: Record<string, string> = {};
      PRODUCT_IMPORT_COLUMNS.forEach((col, i) => (values[col.key] = cells[i] ?? ''));
      rows.push({ rowNo: rowNumber, values });
    });
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`That file has ${rows.length} rows. Please import at most ${MAX_ROWS} at a time.`);
    }
    return rows;
  }

  // ── validate ───────────────────────────────────────────
  private async validate(businessId: number, rows: ParsedRow[]) {
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const plans: RowPlan[] = [];

    const [units, taxes, locations, business] = await Promise.all([
      this.prisma.unit.findMany({ where: { businessId, deletedAt: null }, select: { id: true, actualName: true, shortName: true } }),
      this.prisma.taxRate.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true, amount: true } }),
      this.prisma.businessLocation.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true } }),
      this.prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { defaultProfitPercent: true } }),
    ]);
    const unitByName = new Map<string, number>();
    for (const u of units) {
      unitByName.set(u.actualName.toLowerCase(), u.id);
      if (u.shortName) unitByName.set(u.shortName.toLowerCase(), u.id);
    }
    const taxByName = new Map(taxes.map((t) => [t.name.toLowerCase(), { id: t.id, amount: Number(t.amount) }]));
    const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));
    const defaultProfit = Number(business.defaultProfitPercent);

    const existingSkus = new Set(
      (await this.prisma.product.findMany({ where: { businessId }, select: { sku: true } })).map((p) => p.sku.toLowerCase()),
    );
    const seenSkus = new Set<string>();

    const header = (key: string) => PRODUCT_IMPORT_COLUMNS.find((c) => c.key === key)!.header;
    const err = (row: number, key: string, message: string) => errors.push({ row, column: header(key), message });
    const warn = (row: number, key: string, message: string) => warnings.push({ row, column: header(key), message });

    for (const { rowNo, values: v } of rows) {
      const before = errors.length;

      const name = v.name.trim();
      if (!name) err(rowNo, 'name', 'Product name is required');

      const productType = v.product_type.trim().toLowerCase();
      if (productType === 'combo') {
        warn(rowNo, 'product_type', 'Combo products are not supported by the import — row skipped');
        continue;
      }
      if (productType !== 'single' && productType !== 'variable') {
        err(rowNo, 'product_type', 'Product type must be "single" or "variable"');
      }

      const unitId = unitByName.get(v.unit.trim().toLowerCase());
      if (!v.unit.trim()) err(rowNo, 'unit', 'Unit is required');
      else if (!unitId) err(rowNo, 'unit', `Unit "${v.unit}" was not found — create it first`);

      const manageStock = v.manage_stock.trim();
      if (manageStock !== '0' && manageStock !== '1') err(rowNo, 'manage_stock', 'Manage stock must be 0 or 1');
      const enableStock = manageStock === '1';

      const taxType = v.tax_type.trim().toLowerCase();
      if (taxType !== 'inclusive' && taxType !== 'exclusive') err(rowNo, 'tax_type', 'Selling price tax type must be "inclusive" or "exclusive"');

      let taxId: number | undefined;
      let taxPct = 0;
      if (v.tax.trim()) {
        const t = taxByName.get(v.tax.trim().toLowerCase());
        if (!t) err(rowNo, 'tax', `Tax "${v.tax}" was not found — create it first`);
        else { taxId = t.id; taxPct = t.amount; }
      }

      let barcode = v.barcode_type.trim().toUpperCase() || 'C128';
      if (!BARCODES.has(barcode)) { err(rowNo, 'barcode_type', `Barcode type "${v.barcode_type}" is not one of C128, C39, EAN13, EAN8, UPCA, UPCE`); barcode = 'C128'; }

      let sku: string | undefined = v.sku.trim() || undefined;
      if (sku) {
        const key = sku.toLowerCase();
        if (existingSkus.has(key) || seenSkus.has(key)) err(rowNo, 'sku', `SKU "${sku}" is already used`);
        seenSkus.add(key);
      }

      // Sub-category needs a category (GOURI silently breaks here).
      if (v.sub_category.trim() && !v.category.trim()) err(rowNo, 'sub_category', 'Sub-category needs a CATEGORY to sit under');

      // Opening-stock location, if named, must exist.
      let obLocationName: string | null = null;
      if (v.opening_stock.trim() && enableStock) {
        obLocationName = v.opening_stock_location.trim() || null;
        if (obLocationName && !locByName.has(obLocationName.toLowerCase())) {
          err(rowNo, 'opening_stock_location', `Location "${obLocationName}" was not found`);
        }
      }

      // Product locations (comma-separated), matched to ids; unmatched are warned, not fatal.
      const productLocationIds: number[] = [];
      if (v.product_locations.trim()) {
        for (const nm of v.product_locations.split(',').map((x) => x.trim()).filter(Boolean)) {
          const id = locByName.get(nm.toLowerCase());
          if (id) productLocationIds.push(id);
          else warn(rowNo, 'product_locations', `Location "${nm}" was not found — ignored`);
        }
      }

      // ── prices ──
      const priceOf = (incStr: string, excStr: string, marginStr: string, sellStr: string) => {
        let exc = num(excStr);
        let inc = num(incStr);
        if (exc > 0 && inc <= 0) inc = exc * (1 + taxPct / 100);
        else if (inc > 0 && exc <= 0) exc = inc / (1 + taxPct / 100);
        const margin = marginStr.trim() !== '' ? num(marginStr) : defaultProfit;
        const sell = num(sellStr);
        let sellExc: number;
        let sellInc: number;
        if (sell > 0) {
          if (taxType === 'inclusive') { sellInc = sell; sellExc = sell / (1 + taxPct / 100); }
          else { sellExc = sell; sellInc = sell * (1 + taxPct / 100); }
        } else {
          sellExc = exc * (1 + margin / 100);
          sellInc = sellExc * (1 + taxPct / 100);
        }
        return {
          default_purchase_price: round4(exc),
          dpp_inc_tax: round4(inc),
          profit_percent: round4(margin),
          default_sell_price: round4(sellExc),
          sell_price_inc_tax: round4(sellInc),
        };
      };

      const commonHeader = {
        name,
        type: productType as 'single' | 'variable',
        unit_id: unitId,
        brand_id: undefined,
        category_id: undefined,
        sub_category_id: undefined,
        tax: taxId,
        tax_type: (taxType === 'inclusive' ? 'inclusive' : 'exclusive') as 'inclusive' | 'exclusive',
        enable_stock: enableStock,
        alert_quantity: enableStock && v.alert_quantity.trim() ? num(v.alert_quantity) : undefined,
        sku,
        barcode_type: barcode as SaveProductDto['barcode_type'],
        expiry_period: v.expires_in.trim() ? num(v.expires_in) : undefined,
        expiry_period_type: v.expiry_period_unit.trim().toLowerCase() === 'days' ? 'days' : v.expiry_period_unit.trim().toLowerCase() === 'months' ? 'months' : undefined,
        weight: v.weight.trim() || undefined,
        product_description: v.product_description || undefined,
        not_for_selling: v.not_for_selling.trim() === '1',
        product_custom_field1: v.custom_field1 || undefined,
        product_custom_field2: v.custom_field2 || undefined,
        product_custom_field3: v.custom_field3 || undefined,
        product_custom_field4: v.custom_field4 || undefined,
        image: v.image.trim() || undefined,
        product_locations: productLocationIds.length ? productLocationIds : undefined,
      };

      let dto: SaveProductDto;
      const openingLots: { variationIndex: number; quantity: number; unitCost: number; expDate: string | null }[] = [];

      if (productType === 'variable') {
        const varName = v.variation_name.trim();
        const varValues = pipe(v.variation_values);
        if (!varName) err(rowNo, 'variation_name', 'Variation name is required for a variable product');
        if (varValues.length === 0) err(rowNo, 'variation_values', 'Variation values are required for a variable product');

        const skus = pipe(v.variation_sku);
        const incs = pipe(v.purchase_price_inc);
        const excs = pipe(v.purchase_price_exc);
        const margins = pipe(v.profit_margin);
        const sells = pipe(v.selling_price);
        const stocks = pipe(v.opening_stock);

        const mismatched = [skus, incs, excs, margins, sells, stocks].some((arr) => arr.length > 0 && arr.length !== varValues.length);
        if (mismatched) err(rowNo, 'variation_values', 'Each pipe-separated list must have the same number of entries as VARIATION VALUES');

        if (incs.every((x) => !x) && excs.every((x) => !x)) err(rowNo, 'purchase_price_inc', 'A purchase price is required');

        const valuesDto = varValues.map((val, i) => ({
          value: val,
          sub_sku: skus[i] || undefined,
          ...priceOf(incs[i] ?? '', excs[i] ?? '', margins[i] ?? '', sells[i] ?? ''),
        }));
        varValues.forEach((_, i) => {
          const q = num(stocks[i] ?? '');
          if (enableStock && q > 0) openingLots.push({ variationIndex: i, quantity: q, unitCost: priceOf(incs[i] ?? '', excs[i] ?? '', '', '').default_purchase_price, expDate: v.expiry_date.trim() || null });
        });

        dto = { ...commonHeader, variations: [{ name: varName, values: valuesDto }] } as unknown as SaveProductDto;
      } else {
        if (!v.purchase_price_inc.trim() && !v.purchase_price_exc.trim()) err(rowNo, 'purchase_price_inc', 'A purchase price is required');
        const single = priceOf(v.purchase_price_inc, v.purchase_price_exc, v.profit_margin, v.selling_price);
        const q = num(v.opening_stock);
        if (enableStock && q > 0) openingLots.push({ variationIndex: 0, quantity: q, unitCost: single.default_purchase_price, expDate: v.expiry_date.trim() || null });
        dto = { ...commonHeader, single } as unknown as SaveProductDto;
      }

      if (errors.length > before) continue; // row is bad — keep validating the rest

      plans.push({
        rowNo,
        name,
        type: productType as 'single' | 'variable',
        dto,
        brandName: v.brand.trim() || null,
        categoryName: v.category.trim() || null,
        subCategoryName: v.sub_category.trim() || null,
        openingStock: openingLots.length ? { locationName: obLocationName, lots: openingLots } : null,
      });
    }

    return { errors, warnings, plans };
  }

  // ── run ────────────────────────────────────────────────
  async import(businessId: number, userId: number, file: Express.Multer.File, dryRun: boolean) {
    if (!file) throw new BadRequestException('No file was uploaded');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('That file is larger than 5MB');
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) {
      throw new BadRequestException('Please upload the template as .xlsx or .csv');
    }

    const rows = await this.readRows(file);
    if (rows.length === 0) throw new BadRequestException('The file has no data rows');
    const { errors, warnings, plans } = await this.validate(businessId, rows);

    const report = {
      totalRows: rows.length,
      validRows: plans.length,
      imported: 0,
      errors,
      warnings,
      preview: plans.slice(0, 10).map((p) => ({ row: p.rowNo, name: p.name, type: p.type })),
    };

    if (dryRun || errors.length > 0) return report;

    // Resolve-or-create the on-the-fly catalogue as we go, caching by name.
    const brandCache = new Map<string, number>();
    const categoryCache = new Map<string, number>();

    const auth = { sub: userId, businessId } as never;
    for (const p of plans) {
      const dto = { ...(p.dto as object) } as SaveProductDto & Record<string, unknown>;
      if (p.brandName) dto.brand_id = await this.getOrCreateBrand(businessId, userId, p.brandName, brandCache);
      if (p.categoryName) {
        const catId = await this.getOrCreateCategory(businessId, userId, p.categoryName, null, categoryCache);
        dto.category_id = catId;
        if (p.subCategoryName) dto.sub_category_id = await this.getOrCreateCategory(businessId, userId, p.subCategoryName, catId, categoryCache);
      }

      const created = await this.products.create(businessId, userId, dto as SaveProductDto);

      // Opening stock (if any) via the tested opening-stock path.
      if (p.openingStock) {
        const full = await this.products.findOne(businessId, created.id);
        const variationIds = full.productVariations.flatMap((pv: { variations: { id: number }[] }) => pv.variations.map((vr) => vr.id));
        const locationId = p.openingStock.locationName
          ? (await this.prisma.businessLocation.findFirst({ where: { businessId, name: p.openingStock.locationName, deletedAt: null }, select: { id: true } }))?.id
          : (await this.prisma.businessLocation.findFirst({ where: { businessId, deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true } }))?.id;
        if (locationId) {
          // Opening stock can only sit at a location the product is sold at, so make sure the
          // import target is one of them (a no-op if the row already listed it under PRODUCT LOCATIONS).
          await this.prisma.productLocation.createMany({
            data: [{ productId: created.id, locationId }],
            skipDuplicates: true,
          });
          await this.openingStock.save(auth, created.id, {
            lots: p.openingStock.lots
              .filter((l) => variationIds[l.variationIndex] != null)
              .map((l) => ({
                location_id: locationId,
                variation_id: variationIds[l.variationIndex],
                quantity: l.quantity,
                purchase_price: l.unitCost,
                exp_date: l.expDate ?? undefined,
              })),
          } as never);
        }
      }
      report.imported += 1;
    }

    this.audit.log({
      action: 'imported',
      subjectType: 'Product',
      businessId,
      description: `Imported ${report.imported} product${report.imported === 1 ? '' : 's'} from ${file.originalname}`,
      properties: { attributes: { count: report.imported, fileName: file.originalname, rows: rows.length } },
    });
    return report;
  }

  private async getOrCreateBrand(businessId: number, userId: number, name: string, cache: Map<string, number>): Promise<number> {
    const key = name.toLowerCase();
    if (cache.has(key)) return cache.get(key)!;
    const existing = await this.prisma.brand.findFirst({ where: { businessId, name: { equals: name, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
    const id = existing?.id ?? (await this.prisma.brand.create({ data: { businessId, name, createdBy: userId }, select: { id: true } })).id;
    cache.set(key, id);
    return id;
  }

  private async getOrCreateCategory(businessId: number, userId: number, name: string, parentId: number | null, cache: Map<string, number>): Promise<number> {
    const key = `${parentId ?? 0}:${name.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key)!;
    // Top-level categories have a NULL parent here (GOURI uses a sentinel 0, which our FK rejects).
    const existing = await this.prisma.category.findFirst({
      where: { businessId, name: { equals: name, mode: 'insensitive' }, parentId, categoryType: 'product', deletedAt: null },
      select: { id: true },
    });
    const id = existing?.id ?? (await this.prisma.category.create({ data: { businessId, name, parentId, categoryType: 'product', createdBy: userId }, select: { id: true } })).id;
    cache.set(key, id);
    return id;
  }
}
