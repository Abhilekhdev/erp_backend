import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { CreateActivityCodeDto, UpdateActivityCodeDto } from './dto/activity-code.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

type Row = { id: number; activityName: string; activityCode: string | null };

@Injectable()
export class ActivityCodesService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(a: Row) {
    return { id: a.id, activityName: a.activityName, activityCode: a.activityCode };
  }

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const s = query.search.trim();
    const where: Prisma.ActivityCodeWhereInput = {
      businessId,
      deletedAt: null,
      ...(s
        ? {
            OR: [
              { activityName: { contains: s, mode: 'insensitive' } },
              { activityCode: { contains: s, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.activityCode.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { activityName: 'asc' },
      }),
      this.prisma.activityCode.count({ where }),
    ]);
    return { data: rows.map((r) => this.shape(r)), total };
  }

  async findOne(businessId: number, id: number) {
    const a = await this.prisma.activityCode.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!a) throw new NotFoundException('Activity code not found');
    return this.shape(a);
  }

  async create(businessId: number, dto: CreateActivityCodeDto) {
    const a = await this.prisma.activityCode.create({
      data: { businessId, activityName: dto.activityName, activityCode: blank(dto.activityCode) },
    });
    return this.shape(a);
  }

  async update(businessId: number, id: number, dto: UpdateActivityCodeDto) {
    await this.findOne(businessId, id);
    const data: Prisma.ActivityCodeUncheckedUpdateInput = {};
    if (dto.activityName !== undefined) data.activityName = dto.activityName;
    if (dto.activityCode !== undefined) data.activityCode = blank(dto.activityCode);
    const a = await this.prisma.activityCode.update({ where: { id }, data });
    return this.shape(a);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    await this.prisma.activityCode.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }
}
