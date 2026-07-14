import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveUnitDto } from './dto/save-unit.dto';

type UnitRow = Prisma.UnitGetPayload<{ include: { baseUnit: true } }>;

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(u: UnitRow) {
    return {
      id: u.id,
      actualName: u.actualName,
      shortName: u.shortName,
      allowDecimal: u.allowDecimal,
      baseUnitId: u.baseUnitId,
      baseUnitMultiplier: u.baseUnitMultiplier != null ? Number(u.baseUnitMultiplier) : null,
      baseUnitName: u.baseUnit ? u.baseUnit.actualName : null,
      // "1 <this> = <mult> <base>" — how GOURI describes a sub-unit relationship.
      relation:
        u.baseUnit && u.baseUnitMultiplier != null
          ? `1 ${u.actualName} = ${Number(u.baseUnitMultiplier)} ${u.baseUnit.shortName}`
          : null,
    };
  }

  /** GET /units — every non-deleted unit for the business (GOURI @index datatable feed). */
  async findAll(businessId: number) {
    const rows = await this.prisma.unit.findMany({
      where: { businessId, deletedAt: null },
      include: { baseUnit: true },
      orderBy: { actualName: 'asc' },
    });
    return { data: rows.map((r) => this.shape(r)) };
  }

  /** GET /units/dropdown — base units only, "actual (short)" (GOURI Unit::forDropdown, only_base=true). */
  async forDropdown(businessId: number) {
    const rows = await this.prisma.unit.findMany({
      where: { businessId, deletedAt: null, baseUnitId: null },
      select: { id: true, actualName: true, shortName: true },
      orderBy: { actualName: 'asc' },
    });
    return { data: rows.map((u) => ({ id: u.id, name: `${u.actualName} (${u.shortName})` })) };
  }

  async findOne(businessId: number, id: number) {
    const row = await this.prisma.unit.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { baseUnit: true },
    });
    if (!row) throw new NotFoundException('Unit not found');
    return this.shape(row);
  }

  /** Resolve the sub-unit fields: only a base_unit_id + non-zero multiplier make this a sub-unit. */
  private async resolveBaseUnit(businessId: number, dto: SaveUnitDto, selfId?: number) {
    const isSub =
      dto.base_unit_id != null && dto.base_unit_multiplier != null && dto.base_unit_multiplier !== 0;
    if (!isSub) return { baseUnitId: null, baseUnitMultiplier: null };
    if (dto.base_unit_id === selfId) throw new BadRequestException('A unit cannot be its own base unit');
    const base = await this.prisma.unit.findFirst({
      where: { id: dto.base_unit_id, businessId, deletedAt: null },
      select: { id: true, baseUnitId: true },
    });
    if (!base) throw new BadRequestException('Selected base unit is invalid');
    if (base.baseUnitId != null) {
      throw new BadRequestException('Base unit must itself be a base unit (one level of sub-units)');
    }
    return { baseUnitId: dto.base_unit_id as number, baseUnitMultiplier: dto.base_unit_multiplier as number };
  }

  async create(businessId: number, createdBy: number, dto: SaveUnitDto) {
    const base = await this.resolveBaseUnit(businessId, dto);
    const row = await this.prisma.unit.create({
      data: {
        businessId,
        createdBy,
        actualName: dto.actual_name,
        shortName: dto.short_name,
        allowDecimal: dto.allow_decimal,
        baseUnitId: base.baseUnitId,
        baseUnitMultiplier: base.baseUnitMultiplier,
        createdAt: new Date(),
      },
    });
    return this.findOne(businessId, row.id);
  }

  async update(businessId: number, id: number, dto: SaveUnitDto) {
    await this.findOne(businessId, id); // 404 if not in this business
    const base = await this.resolveBaseUnit(businessId, dto, id);
    await this.prisma.unit.update({
      where: { id },
      data: {
        actualName: dto.actual_name,
        shortName: dto.short_name,
        allowDecimal: dto.allow_decimal,
        baseUnitId: base.baseUnitId,
        baseUnitMultiplier: base.baseUnitMultiplier,
      },
    });
    return this.findOne(businessId, id);
  }

  /** DELETE /units/:id — soft delete (GOURI SoftDeletes). Blocked if it is the base of other units. */
  async remove(businessId: number, id: number) {
    const row = await this.prisma.unit.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!row) throw new NotFoundException('Unit not found');
    const subCount = await this.prisma.unit.count({
      where: { businessId, baseUnitId: id, deletedAt: null },
    });
    if (subCount > 0) {
      throw new BadRequestException('This unit is the base for other sub-units — remove those first');
    }
    // NOTE: GOURI also blocks deletion when a product references the unit. Add that guard once the
    // Products module exists (products.unit_id).
    await this.prisma.unit.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true, msg: 'Unit deleted successfully' };
  }
}
