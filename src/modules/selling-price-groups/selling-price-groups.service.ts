import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SellingPriceGroup } from '@prisma/client';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveSellingPriceGroupDto } from './dto/save-selling-price-group.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

/** Fixed leading columns of the price-group workbook; every column after these is a group. */
const FIXED_COLUMNS = ['Product', 'SKU', 'Base Selling Price'] as const;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface UploadedSheet {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class SellingPriceGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(g: SellingPriceGroup) {
    return {
      id: g.id,
      name: g.name,
      description: g.description ?? '',
      isActive: g.isActive,
    };
  }

  async findAll(businessId: number) {
    const rows = await this.prisma.sellingPriceGroup.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return { data: rows.map((r) => this.shape(r)) };
  }

  /** Active groups for the price grid / product form. */
  async forDropdown(businessId: number) {
    const rows = await this.prisma.sellingPriceGroup.findMany({
      where: { businessId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    // NOTE: GOURI additionally filters by the per-group `selling_price_group.{id}` permission — layer
    // that in once product pricing consumes these groups.
    return { data: rows };
  }

  async findOne(businessId: number, id: number) {
    const row = await this.prisma.sellingPriceGroup.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!row) throw new NotFoundException('Selling price group not found');
    return this.shape(row);
  }

  async create(businessId: number, dto: SaveSellingPriceGroupDto) {
    const row = await this.prisma.sellingPriceGroup.create({
      data: { businessId, name: dto.name, description: blank(dto.description), createdAt: new Date() },
    });
    // Mint the dynamic permission so this group can be granted to roles (GOURI Permission::create).
    await this.ensureGroupPermission(row.id);
    return this.findOne(businessId, row.id);
  }

  async update(businessId: number, id: number, dto: SaveSellingPriceGroupDto) {
    await this.findOne(businessId, id);
    await this.prisma.sellingPriceGroup.update({
      where: { id },
      data: { name: dto.name, description: blank(dto.description) },
    });
    return this.findOne(businessId, id);
  }

  async setActive(businessId: number, id: number, active: boolean) {
    await this.findOne(businessId, id);
    await this.prisma.sellingPriceGroup.update({ where: { id }, data: { isActive: active } });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    await this.prisma.sellingPriceGroup.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true, msg: 'Selling price group deleted successfully' };
  }

  // ── export / import (GOURI's price-group workbook) ────

  /**
   * Every sellable variation with a column per active price group — the same sheet the import
   * reads back, so a business can bulk-edit its price list in Excel.
   */
  async exportPrices(businessId: number): Promise<Buffer> {
    const [groups, variations] = await Promise.all([
      this.prisma.sellingPriceGroup.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.variation.findMany({
        // Combos are excluded in GOURI — their price is derived from their components.
        where: { deletedAt: null, product: { businessId, type: { in: ['single', 'variable'] } } },
        include: { product: { select: { name: true, type: true } }, productVariation: { select: { name: true } }, groupPrices: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Group prices');
    ws.addRow([...FIXED_COLUMNS, ...groups.map((g) => g.name)]);
    ws.getRow(1).font = { bold: true };
    ws.columns = [
      { width: 40 },
      { width: 20 },
      { width: 18 },
      ...groups.map(() => ({ width: 16 })),
    ];

    for (const v of variations) {
      const label =
        v.product.type === 'single'
          ? v.product.name
          : `${v.product.name} - ${v.productVariation.name} - ${v.name}`;
      const priceOf = (groupId: number) => {
        const hit = v.groupPrices.find((g) => g.priceGroupId === groupId);
        return hit ? Number(hit.priceIncTax) : '';
      };
      ws.addRow([
        label,
        v.subSku ?? '',
        v.sellPriceIncTax != null ? Number(v.sellPriceIncTax) : '',
        ...groups.map((g) => priceOf(g.id)),
      ]);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * Read the workbook back. Rows are matched on SKU and columns on price-group name; anything the
   * business doesn't have is reported rather than silently skipped.
   *
   * GOURI looks the SKU up with `Variation::where('sub_sku', …)` and **no business scoping**, so one
   * tenant's upload can rewrite another tenant's prices. Every lookup here is tenant-scoped.
   */
  async importPrices(businessId: number, file?: UploadedSheet) {
    if (!file) throw new BadRequestException('Please choose a file to import');
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) {
      throw new BadRequestException('Unsupported file type — upload the exported .xlsx or a .csv');
    }
    if (file.size > MAX_IMPORT_BYTES) throw new BadRequestException('That file is larger than 5 MB');

    const wb = new ExcelJS.Workbook();
    try {
      if (/\.csv$/i.test(file.originalname)) await wb.csv.read(Readable.from(file.buffer));
      else await wb.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Could not read that file');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The file has no sheets');

    const cell = (row: ExcelJS.Row, i: number): string => {
      const v = row.getCell(i).value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && 'result' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '').trim();
      return String(v).trim();
    };

    const header = ws.getRow(1);
    const groups = await this.prisma.sellingPriceGroup.findMany({
      where: { businessId, deletedAt: null, isActive: true },
    });
    const byName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g.id]));

    // Column index → price group id, for every header we recognise after the fixed columns.
    const columns: { index: number; groupId: number; name: string }[] = [];
    const unknownColumns: string[] = [];
    for (let i = FIXED_COLUMNS.length + 1; i <= header.cellCount; i++) {
      const name = cell(header, i);
      if (!name) continue;
      const groupId = byName.get(name.toLowerCase());
      if (groupId) columns.push({ index: i, groupId, name });
      else unknownColumns.push(name);
    }
    if (!columns.length) {
      throw new BadRequestException(
        'No matching price groups in that file — the column headers must match your selling price group names',
      );
    }

    const errors: { row: number; message: string }[] = [];
    const writes: { variationId: number; priceGroupId: number; price: number }[] = [];
    let scanned = 0;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const sku = cell(row, 2);
      if (!sku) continue; // blank spacer row
      scanned += 1;

      const variation = await this.prisma.variation.findFirst({
        where: { subSku: sku, deletedAt: null, product: { businessId } },
        select: { id: true },
      });
      if (!variation) {
        errors.push({ row: r, message: `No product found with SKU "${sku}"` });
        continue;
      }
      for (const col of columns) {
        const raw = cell(row, col.index);
        if (raw === '') continue; // blank = leave the existing price alone
        const price = Number(raw);
        if (Number.isNaN(price) || price < 0) {
          errors.push({ row: r, message: `"${raw}" is not a valid price for ${col.name}` });
          continue;
        }
        writes.push({ variationId: variation.id, priceGroupId: col.groupId, price });
      }
    }

    // All-or-nothing, like every other import here: a half-applied price list is worse than none.
    if (errors.length) {
      return { imported: 0, rows: scanned, updated: 0, errors, unknownColumns, groups: columns.map((c) => c.name) };
    }

    // Delete-then-insert rather than N upserts: a price list is hundreds of rows, and on a
    // serverless DB each upsert would be its own round-trip. This is two statements whatever the size.
    await this.prisma.$transaction(async (tx) => {
      await tx.variationGroupPrice.deleteMany({
        where: {
          OR: writes.map((w) => ({ variationId: w.variationId, priceGroupId: w.priceGroupId })),
        },
      });
      await tx.variationGroupPrice.createMany({
        data: writes.map((w) => ({
          variationId: w.variationId,
          priceGroupId: w.priceGroupId,
          priceIncTax: w.price,
        })),
      });
    });

    return {
      imported: scanned,
      rows: scanned,
      updated: writes.length,
      errors,
      unknownColumns,
      groups: columns.map((c) => c.name),
    };
  }

  private async ensureGroupPermission(groupId: number) {
    const name = `selling_price_group.${groupId}`;
    await this.prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, resource: 'selling_price_group', action: String(groupId) },
    });
  }
}
