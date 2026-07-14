import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveTaxGroupDto, SaveTaxRateDto } from './dto/save-tax-rate.dto';

type RateWithMembers = Prisma.TaxRateGetPayload<{ include: { members: { include: { member: true } } } }>;

@Injectable()
export class TaxRatesService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(r: RateWithMembers) {
    return {
      id: r.id,
      name: r.name,
      amount: Number(r.amount),
      isTaxGroup: r.isTaxGroup,
      forTaxGroup: r.forTaxGroup,
      subTaxes: r.isTaxGroup
        ? r.members
            .filter((m) => m.member.deletedAt == null)
            .map((m) => ({ id: m.member.id, name: m.member.name, amount: Number(m.member.amount) }))
        : [],
    };
  }

  /** GET /tax-rates — every simple rate AND tax group for the business. */
  async findAll(businessId: number) {
    const rows = await this.prisma.taxRate.findMany({
      where: { businessId, deletedAt: null },
      include: { members: { include: { member: true } } },
      orderBy: [{ isTaxGroup: 'asc' }, { name: 'asc' }],
    });
    return { data: rows.map((r) => this.shape(r)) };
  }

  /** GET /tax-rates/dropdown — rates+groups usable on a product (GOURI excludeForTaxGroup). */
  async forDropdown(businessId: number) {
    const rows = await this.prisma.taxRate.findMany({
      where: { businessId, deletedAt: null, forTaxGroup: false },
      select: { id: true, name: true, amount: true, isTaxGroup: true },
      orderBy: [{ isTaxGroup: 'asc' }, { name: 'asc' }],
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        amount: Number(r.amount),
        isTaxGroup: r.isTaxGroup,
      })),
    };
  }

  async findRate(businessId: number, id: number) {
    const row = await this.prisma.taxRate.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { members: { include: { member: true } } },
    });
    if (!row) throw new NotFoundException('Tax rate not found');
    return this.shape(row);
  }

  // ── simple rates ────────────────────────────────────────
  async createRate(businessId: number, createdBy: number, dto: SaveTaxRateDto) {
    const row = await this.prisma.taxRate.create({
      data: {
        businessId,
        createdBy,
        name: dto.name,
        amount: dto.amount,
        isTaxGroup: false,
        forTaxGroup: dto.for_tax_group,
        createdAt: new Date(),
      },
    });
    return this.findRate(businessId, row.id);
  }

  async updateRate(businessId: number, id: number, dto: SaveTaxRateDto) {
    const existing = await this.prisma.taxRate.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Tax rate not found');
    if (existing.isTaxGroup) throw new BadRequestException('Use the tax-group endpoint to edit a group');
    await this.prisma.taxRate.update({
      where: { id },
      data: { name: dto.name, amount: dto.amount, forTaxGroup: dto.for_tax_group },
    });
    // Changing a member rate's amount re-sums every group that contains it (GOURI updateGroupTaxAmount).
    await this.recomputeGroupsContaining(id);
    return this.findRate(businessId, id);
  }

  // ── tax groups ──────────────────────────────────────────
  /** Group edit form source — its member simple-rate ids. */
  async getGroup(businessId: number, id: number) {
    const row = await this.prisma.taxRate.findFirst({
      where: { id, businessId, isTaxGroup: true, deletedAt: null },
      include: { members: true },
    });
    if (!row) throw new NotFoundException('Tax group not found');
    return { id: row.id, name: row.name, taxes: row.members.map((m) => m.taxId) };
  }

  private async validateMembers(businessId: number, taxIds: number[]): Promise<number> {
    const ids = [...new Set(taxIds)];
    const members = await this.prisma.taxRate.findMany({
      where: { id: { in: ids }, businessId, isTaxGroup: false, deletedAt: null },
      select: { amount: true },
    });
    if (members.length !== ids.length) {
      throw new BadRequestException('One or more selected tax rates are invalid');
    }
    return members.reduce((a, m) => a + Number(m.amount), 0);
  }

  async createGroup(businessId: number, createdBy: number, dto: SaveTaxGroupDto) {
    const amount = await this.validateMembers(businessId, dto.taxes);
    const ids = [...new Set(dto.taxes)];
    const groupId = await this.prisma.$transaction(async (tx) => {
      const g = await tx.taxRate.create({
        data: {
          businessId,
          createdBy,
          name: dto.name,
          amount,
          isTaxGroup: true,
          forTaxGroup: false,
          createdAt: new Date(),
        },
      });
      await tx.groupSubTax.createMany({ data: ids.map((taxId) => ({ groupTaxId: g.id, taxId })) });
      return g.id;
    });
    return this.findRate(businessId, groupId);
  }

  async updateGroup(businessId: number, id: number, dto: SaveTaxGroupDto) {
    const existing = await this.prisma.taxRate.findFirst({
      where: { id, businessId, isTaxGroup: true, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Tax group not found');
    const amount = await this.validateMembers(businessId, dto.taxes);
    const ids = [...new Set(dto.taxes)];
    await this.prisma.$transaction(async (tx) => {
      await tx.taxRate.update({ where: { id }, data: { name: dto.name, amount } });
      await tx.groupSubTax.deleteMany({ where: { groupTaxId: id } });
      await tx.groupSubTax.createMany({ data: ids.map((taxId) => ({ groupTaxId: id, taxId })) });
    });
    return this.findRate(businessId, id);
  }

  // ── delete (both) ───────────────────────────────────────
  async remove(businessId: number, id: number) {
    const row = await this.prisma.taxRate.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!row) throw new NotFoundException('Tax rate not found');
    if (!row.isTaxGroup) {
      const inGroups = await this.prisma.groupSubTax.count({ where: { taxId: id } });
      if (inGroups > 0) {
        throw new BadRequestException('This rate belongs to a tax group — remove it from the group first');
      }
    }
    await this.prisma.$transaction([
      // If it's a group, drop its membership rows first.
      this.prisma.groupSubTax.deleteMany({ where: { groupTaxId: id } }),
      this.prisma.taxRate.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
    return { success: true, msg: 'Tax rate deleted successfully' };
  }

  /** Re-sum every group that contains the given member rate. */
  private async recomputeGroupsContaining(rateId: number) {
    const pivots = await this.prisma.groupSubTax.findMany({
      where: { taxId: rateId },
      select: { groupTaxId: true },
    });
    for (const p of pivots) {
      const members = await this.prisma.groupSubTax.findMany({
        where: { groupTaxId: p.groupTaxId },
        include: { member: true },
      });
      const amount = members.reduce((a, m) => a + Number(m.member.amount), 0);
      await this.prisma.taxRate.update({ where: { id: p.groupTaxId }, data: { amount } });
    }
  }
}
