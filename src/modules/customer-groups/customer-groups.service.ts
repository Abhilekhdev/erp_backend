import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveCustomerGroupDto } from './dto/save-customer-group.dto';

interface CustomerGroupRow {
  id: number;
  name: string;
  amount: unknown;
  priceCalculationType: string;
  sellingPriceGroupId: number | null;
}

@Injectable()
export class CustomerGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(row: CustomerGroupRow) {
    return {
      id: row.id,
      name: row.name,
      priceCalculationType: row.priceCalculationType,
      amount: row.amount != null ? Number(row.amount) : 0,
      sellingPriceGroupId: row.sellingPriceGroupId,
    };
  }

  /** GET /customer-groups — all groups for the business (GOURI @index datatable feed). */
  async findAll(businessId: number) {
    const rows = await this.prisma.customerGroup.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
    });
    return { data: rows.map((r) => this.shape(r)) };
  }

  /** GET /customer-groups/dropdown — {id,name} options (GOURI CustomerGroup::forDropdown). */
  async forDropdown(businessId: number) {
    const rows = await this.prisma.customerGroup.findMany({
      where: { businessId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { data: rows };
  }

  async findOne(businessId: number, id: number) {
    const row = await this.prisma.customerGroup.findFirst({ where: { id, businessId } });
    if (!row) throw new NotFoundException('Customer group not found');
    return this.shape(row);
  }

  /** POST /customer-groups — GOURI @store. Percentage groups store `amount`; price-group ones store the group id. */
  async create(businessId: number, createdBy: number, dto: SaveCustomerGroupDto) {
    const row = await this.prisma.customerGroup.create({
      data: {
        businessId,
        createdBy,
        name: dto.name,
        priceCalculationType: dto.price_calculation_type,
        amount: dto.price_calculation_type === 'percentage' ? (dto.amount ?? 0) : 0,
        sellingPriceGroupId:
          dto.price_calculation_type === 'selling_price_group' ? (dto.selling_price_group_id ?? null) : null,
        createdAt: new Date(),
      },
    });
    return this.findOne(businessId, row.id);
  }

  /** PATCH /customer-groups/:id — GOURI @update. */
  async update(businessId: number, id: number, dto: SaveCustomerGroupDto) {
    await this.findOne(businessId, id); // 404 if not in this business
    await this.prisma.customerGroup.update({
      where: { id },
      data: {
        name: dto.name,
        priceCalculationType: dto.price_calculation_type,
        amount: dto.price_calculation_type === 'percentage' ? (dto.amount ?? 0) : 0,
        sellingPriceGroupId:
          dto.price_calculation_type === 'selling_price_group' ? (dto.selling_price_group_id ?? null) : null,
      },
    });
    return this.findOne(businessId, id);
  }

  /** DELETE /customer-groups/:id — GOURI @destroy. */
  async remove(businessId: number, id: number) {
    const row = await this.prisma.customerGroup.findFirst({ where: { id, businessId } });
    if (!row) throw new NotFoundException('Customer group not found');
    // Detach any contacts pointing at this group so we don't orphan the FK.
    await this.prisma.contact.updateMany({
      where: { businessId, customerGroupId: id },
      data: { customerGroupId: null },
    });
    await this.prisma.customerGroup.delete({ where: { id } });
    return { success: true, msg: 'Customer group deleted successfully' };
  }
}
