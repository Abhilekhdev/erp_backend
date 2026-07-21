import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Barcode, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveBarcodeDto } from './dto/save-barcode.dto';

const num = (v: Prisma.Decimal | null): number | null => (v == null ? null : Number(v));

@Injectable()
export class BarcodesService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(b: Barcode) {
    return {
      id: b.id,
      name: b.name,
      description: b.description ?? '',
      width: num(b.width),
      height: num(b.height),
      paperWidth: num(b.paperWidth),
      paperHeight: num(b.paperHeight),
      topMargin: num(b.topMargin),
      leftMargin: num(b.leftMargin),
      rowDistance: num(b.rowDistance),
      colDistance: num(b.colDistance),
      stickersInOneRow: b.stickersInOneRow,
      stickersInOneSheet: b.stickersInOneSheet,
      isDefault: b.isDefault,
      isContinuous: b.isContinuous,
      /** Built-in presets (businessId null) are shared and read-only. */
      isSystem: b.businessId == null,
    };
  }

  /** Both the tenant's own sheets and the shared built-in presets. */
  private scope(businessId: number): Prisma.BarcodeWhereInput {
    return { OR: [{ businessId }, { businessId: null }] };
  }

  async findAll(businessId: number) {
    const rows = await this.prisma.barcode.findMany({
      where: this.scope(businessId),
      // Default first (it is what Print Labels preselects), then the tenant's own, then presets.
      orderBy: [{ isDefault: 'desc' }, { businessId: 'desc' }, { name: 'asc' }],
    });
    // "Default" is a per-business choice, so a shared preset never stores the flag. Until a business
    // picks one, mark the fallback preset as its default so exactly one row is flagged, always.
    const fallbackId = rows.some((r) => r.isDefault) ? null : this.fallbackId(rows);
    return { data: rows.map((r) => ({ ...this.shape(r), isDefault: r.isDefault || r.id === fallbackId })) };
  }

  /** The preset a business lands on before choosing: the lowest-id shared row. */
  private fallbackId(rows: Barcode[]): number | null {
    const presets = rows.filter((r) => r.businessId == null);
    return presets.length ? presets.reduce((a, b) => (a.id <= b.id ? a : b)).id : (rows[0]?.id ?? null);
  }

  async findOne(businessId: number, id: number) {
    const row = await this.prisma.barcode.findFirst({ where: { id, ...this.scope(businessId) } });
    if (!row) throw new NotFoundException('Label sheet not found');
    return this.shape(row);
  }

  /** The sheet Print Labels should start on: the tenant's chosen default, else the fallback preset. */
  async defaultSheet(businessId: number) {
    const chosen = await this.prisma.barcode.findFirst({ where: { businessId, isDefault: true } });
    if (chosen) return this.shape(chosen);
    const preset = await this.prisma.barcode.findFirst({ where: { businessId: null }, orderBy: { id: 'asc' } });
    return preset ? { ...this.shape(preset), isDefault: true } : null;
  }

  private data(dto: SaveBarcodeDto) {
    return {
      name: dto.name,
      description: dto.description || null,
      width: dto.width ?? null,
      height: dto.height ?? null,
      paperWidth: dto.paper_width ?? null,
      paperHeight: dto.paper_height ?? null,
      topMargin: dto.top_margin ?? null,
      leftMargin: dto.left_margin ?? null,
      rowDistance: dto.row_distance ?? null,
      colDistance: dto.col_distance ?? null,
      stickersInOneRow: dto.stickers_in_one_row ?? null,
      stickersInOneSheet: dto.stickers_in_one_sheet ?? null,
      isContinuous: dto.is_continuous,
    };
  }

  async create(businessId: number, dto: SaveBarcodeDto) {
    const row = await this.prisma.barcode.create({ data: { ...this.data(dto), businessId } });
    return this.shape(row);
  }

  /** Own sheets only — a shared preset must stay identical for every tenant. */
  private async assertOwned(businessId: number, id: number): Promise<Barcode> {
    const row = await this.prisma.barcode.findFirst({ where: { id, ...this.scope(businessId) } });
    if (!row) throw new NotFoundException('Label sheet not found');
    if (row.businessId == null) {
      throw new BadRequestException('Built-in label sheets cannot be changed — duplicate one instead');
    }
    return row;
  }

  async update(businessId: number, id: number, dto: SaveBarcodeDto) {
    await this.assertOwned(businessId, id);
    const row = await this.prisma.barcode.update({ where: { id }, data: this.data(dto) });
    return this.shape(row);
  }

  async remove(businessId: number, id: number) {
    const row = await this.assertOwned(businessId, id);
    // GOURI disables the delete button for the default; enforce it server-side too, or Print Labels
    // would be left with no sheet preselected.
    if (row.isDefault) throw new BadRequestException('The default label sheet cannot be deleted');
    await this.prisma.barcode.delete({ where: { id } });
    return { success: true, msg: 'Label sheet deleted successfully' };
  }

  /**
   * Make one sheet the tenant's default. A built-in preset CAN be chosen — the flag is stored on a
   * per-tenant copy so one business's choice never changes another's.
   */
  async setDefault(businessId: number, id: number) {
    const row = await this.prisma.barcode.findFirst({ where: { id, ...this.scope(businessId) } });
    if (!row) throw new NotFoundException('Label sheet not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.barcode.updateMany({ where: { businessId, isDefault: true }, data: { isDefault: false } });

      if (row.businessId === businessId) {
        const updated = await tx.barcode.update({ where: { id }, data: { isDefault: true } });
        return this.shape(updated);
      }
      // Copy the preset into this tenant so `isDefault` is per-business, never global.
      const { id: _id, businessId: _b, createdAt: _c, updatedAt: _u, ...rest } = row;
      const copy = await tx.barcode.create({ data: { ...rest, businessId, isDefault: true } });
      return this.shape(copy);
    });
  }
}
