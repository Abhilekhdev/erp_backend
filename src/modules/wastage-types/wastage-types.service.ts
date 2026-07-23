import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface SaveWastageTypeDto {
  name: string;
}

/**
 * Wastage Types master (GOURI `wastage_types`) — the list a stock adjustment's "adjustment type"
 * points at. GOURI does no server validation; we add a required + unique-per-business name (the
 * "keep the flow, harden the code" brief).
 */
@Injectable()
export class WastageTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(businessId: number) {
    const rows = await this.prisma.wastageType.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return { data: rows };
  }

  async dropdown(businessId: number) {
    return this.findAll(businessId);
  }

  private async assertUniqueName(businessId: number, name: string, exceptId?: number) {
    const clash = await this.prisma.wastageType.findFirst({
      where: { businessId, deletedAt: null, name: { equals: name, mode: 'insensitive' }, id: exceptId ? { not: exceptId } : undefined },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A wastage type with this name already exists');
  }

  async create(businessId: number, createdBy: number, dto: SaveWastageTypeDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Name is required');
    await this.assertUniqueName(businessId, name);
    const row = await this.prisma.wastageType.create({
      data: { businessId, createdBy, name },
      select: { id: true, name: true },
    });
    return row;
  }

  async update(businessId: number, id: number, dto: SaveWastageTypeDto) {
    const existing = await this.prisma.wastageType.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Wastage type not found');
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Name is required');
    await this.assertUniqueName(businessId, name, id);
    const row = await this.prisma.wastageType.update({
      where: { id },
      data: { name },
      select: { id: true, name: true },
    });
    return row;
  }

  async remove(businessId: number, id: number) {
    const existing = await this.prisma.wastageType.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Wastage type not found');
    // Block deletion if any stock adjustment still references it (GOURI leaves an orphan id).
    const inUse = await this.prisma.transaction.count({ where: { businessId, adjustmentTypeId: id } });
    if (inUse > 0) {
      throw new ConflictException('This wastage type is used by stock adjustments and cannot be deleted');
    }
    await this.prisma.wastageType.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true, msg: 'Wastage type deleted' };
  }
}
