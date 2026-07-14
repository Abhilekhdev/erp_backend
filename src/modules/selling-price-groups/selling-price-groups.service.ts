import { Injectable, NotFoundException } from '@nestjs/common';
import type { SellingPriceGroup } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveSellingPriceGroupDto } from './dto/save-selling-price-group.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

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

  private async ensureGroupPermission(groupId: number) {
    const name = `selling_price_group.${groupId}`;
    await this.prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, resource: 'selling_price_group', action: String(groupId) },
    });
  }
}
