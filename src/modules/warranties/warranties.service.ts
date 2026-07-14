import { Injectable, NotFoundException } from '@nestjs/common';
import type { Warranty } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveWarrantyDto } from './dto/save-warranty.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

@Injectable()
export class WarrantiesService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(w: Warranty) {
    return {
      id: w.id,
      name: w.name,
      description: w.description ?? '',
      duration: w.duration,
      durationType: w.durationType,
    };
  }

  async findAll(businessId: number) {
    const rows = await this.prisma.warranty.findMany({ where: { businessId }, orderBy: { name: 'asc' } });
    return { data: rows.map((r) => this.shape(r)) };
  }

  async forDropdown(businessId: number) {
    const rows = await this.prisma.warranty.findMany({
      where: { businessId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { data: rows };
  }

  async findOne(businessId: number, id: number) {
    const row = await this.prisma.warranty.findFirst({ where: { id, businessId } });
    if (!row) throw new NotFoundException('Warranty not found');
    return this.shape(row);
  }

  async create(businessId: number, dto: SaveWarrantyDto) {
    const row = await this.prisma.warranty.create({
      data: {
        businessId,
        name: dto.name,
        description: blank(dto.description),
        duration: dto.duration,
        durationType: dto.duration_type,
        createdAt: new Date(),
      },
    });
    return this.findOne(businessId, row.id);
  }

  async update(businessId: number, id: number, dto: SaveWarrantyDto) {
    await this.findOne(businessId, id);
    await this.prisma.warranty.update({
      where: { id },
      data: {
        name: dto.name,
        description: blank(dto.description),
        duration: dto.duration,
        durationType: dto.duration_type,
      },
    });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    await this.prisma.warranty.delete({ where: { id } });
    return { success: true, msg: 'Warranty deleted successfully' };
  }
}
