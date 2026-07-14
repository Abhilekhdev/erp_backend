import { Injectable, NotFoundException } from '@nestjs/common';
import type { Brand } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveBrandDto } from './dto/save-brand.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(b: Brand) {
    return {
      id: b.id,
      name: b.name,
      description: b.description ?? '',
      useForRepair: Boolean(b.useForRepair),
    };
  }

  /** GET /brands — all non-deleted brands for the business. */
  async findAll(businessId: number) {
    const rows = await this.prisma.brand.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return { data: rows.map((r) => this.shape(r)) };
  }

  /** GET /brands/dropdown — {id,name} options (GOURI Brands::forDropdown). */
  async forDropdown(businessId: number) {
    const rows = await this.prisma.brand.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { data: rows };
  }

  async findOne(businessId: number, id: number) {
    const row = await this.prisma.brand.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!row) throw new NotFoundException('Brand not found');
    return this.shape(row);
  }

  async create(businessId: number, createdBy: number, dto: SaveBrandDto) {
    const row = await this.prisma.brand.create({
      data: {
        businessId,
        createdBy,
        name: dto.name,
        description: blank(dto.description),
        useForRepair: dto.use_for_repair,
        createdAt: new Date(),
      },
    });
    return this.findOne(businessId, row.id);
  }

  async update(businessId: number, id: number, dto: SaveBrandDto) {
    await this.findOne(businessId, id);
    await this.prisma.brand.update({
      where: { id },
      data: {
        name: dto.name,
        description: blank(dto.description),
        useForRepair: dto.use_for_repair,
      },
    });
    return this.findOne(businessId, id);
  }

  /** DELETE /brands/:id — soft delete (GOURI SoftDeletes). */
  async remove(businessId: number, id: number) {
    const row = await this.prisma.brand.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!row) throw new NotFoundException('Brand not found');
    // NOTE: add a "referenced by a product" guard once the Products module exists (products.brand_id).
    await this.prisma.brand.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true, msg: 'Brand deleted successfully' };
  }
}
