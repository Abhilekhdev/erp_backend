import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SchemeType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { INVOICE_SCHEME_SEPARATOR } from './invoice-schemes.constants';
import type { SaveInvoiceSchemeDto } from './dto/save-invoice-scheme.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const toDb = (t: 'blank' | 'year'): SchemeType => (t === 'year' ? SchemeType.YEAR : SchemeType.BLANK);
const toApi = (t: SchemeType): 'blank' | 'year' => (t === SchemeType.YEAR ? 'year' : 'blank');

interface SchemeRow {
  id: number;
  name: string;
  schemeType: SchemeType;
  prefix: string | null;
  startNumber: number | null;
  invoiceCount: number;
  totalDigits: number | null;
  isDefault: boolean;
}

@Injectable()
export class InvoiceSchemesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The `prefix` column as GOURI renders it: `year` schemes append current year + separator. */
  private prefixDisplay(row: { schemeType: SchemeType; prefix: string | null }, year: number): string {
    const p = row.prefix ?? '';
    return row.schemeType === SchemeType.YEAR ? `${p}${year}${INVOICE_SCHEME_SEPARATOR}` : p;
  }

  private shape(row: SchemeRow, year: number) {
    return {
      id: row.id,
      name: row.name,
      schemeType: toApi(row.schemeType),
      prefix: row.prefix ?? '',
      prefixDisplay: this.prefixDisplay(row, year),
      startNumber: row.startNumber ?? 0,
      invoiceCount: row.invoiceCount,
      totalDigits: row.totalDigits ?? 4,
      isDefault: row.isDefault,
    };
  }

  /** GET /invoice-schemes — every scheme for the business (GOURI @index datatable feed). */
  async findAll(businessId: number) {
    const year = new Date().getFullYear();
    const rows = await this.prisma.invoiceScheme.findMany({
      where: { businessId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return { data: rows.map((r) => this.shape(r, year)) };
  }

  /** GET /invoice-schemes/:id — single scheme (edit form source). */
  async findOne(businessId: number, id: number) {
    const row = await this.prisma.invoiceScheme.findFirst({ where: { id, businessId } });
    if (!row) throw new NotFoundException('Invoice scheme not found');
    return this.shape(row, new Date().getFullYear());
  }

  /** POST /invoice-schemes — create (GOURI @store; unsets any existing default when is_default set). */
  async create(businessId: number, dto: SaveInvoiceSchemeDto) {
    if (dto.is_default) await this.clearDefault(businessId);

    const row = await this.prisma.invoiceScheme.create({
      data: {
        businessId,
        name: dto.name,
        schemeType: toDb(dto.scheme_type),
        prefix: blank(dto.prefix ?? null),
        startNumber: dto.start_number ?? 0,
        totalDigits: dto.total_digits ?? 4,
        isDefault: dto.is_default ?? false,
      },
    });
    return this.findOne(businessId, row.id);
  }

  /**
   * PATCH /invoice-schemes/:id — update (GOURI @update).
   * Matches GOURI exactly: only name/scheme_type/prefix/start_number/total_digits change here;
   * the default flag is managed solely via setDefault (the edit form has no default checkbox).
   */
  async update(businessId: number, id: number, dto: SaveInvoiceSchemeDto) {
    await this.findOne(businessId, id); // 404 if not in this business
    await this.prisma.invoiceScheme.update({
      where: { id },
      data: {
        name: dto.name,
        schemeType: toDb(dto.scheme_type),
        prefix: blank(dto.prefix ?? null),
        startNumber: dto.start_number ?? 0,
        totalDigits: dto.total_digits ?? 4,
      },
    });
    return this.findOne(businessId, id);
  }

  /** DELETE /invoice-schemes/:id — GOURI @destroy blocks deleting the default scheme. */
  async remove(businessId: number, id: number) {
    const row = await this.prisma.invoiceScheme.findFirst({ where: { id, businessId } });
    if (!row) throw new NotFoundException('Invoice scheme not found');
    if (row.isDefault) {
      throw new BadRequestException('The default invoice scheme cannot be deleted');
    }
    await this.prisma.invoiceScheme.delete({ where: { id } });
    return { success: true, msg: 'Invoice scheme deleted successfully' };
  }

  /** POST /invoice-schemes/:id/set-default — make this the sole default (GOURI @setDefault). */
  async setDefault(businessId: number, id: number) {
    const row = await this.prisma.invoiceScheme.findFirst({ where: { id, businessId } });
    if (!row) throw new NotFoundException('Invoice scheme not found');
    await this.clearDefault(businessId);
    await this.prisma.invoiceScheme.update({ where: { id }, data: { isDefault: true } });
    return { success: true, msg: 'Invoice scheme set as default successfully' };
  }

  private async clearDefault(businessId: number): Promise<void> {
    await this.prisma.invoiceScheme.updateMany({
      where: { businessId, isDefault: true },
      data: { isDefault: false },
    });
  }
}
