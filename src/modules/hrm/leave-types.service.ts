import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { CreateLeaveTypeDto, UpdateLeaveTypeDto } from './dto/leave-type.dto';

const mapInterval = (v?: string | null): 'MONTH' | 'YEAR' | null =>
  v ? (v.toUpperCase() as 'MONTH' | 'YEAR') : null;

type LeaveTypeRow = {
  id: number;
  name: string;
  maxLeaveCount: number | null;
  leaveCountInterval: 'MONTH' | 'YEAR' | null;
  isPaid: boolean;
};

@Injectable()
export class LeaveTypesService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(r: LeaveTypeRow) {
    return {
      id: r.id,
      name: r.name,
      maxLeaveCount: r.maxLeaveCount,
      leaveCountInterval: r.leaveCountInterval ? r.leaveCountInterval.toLowerCase() : '',
      isPaid: r.isPaid,
    };
  }

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const s = query.search.trim();
    const where: Prisma.LeaveTypeWhereInput = {
      businessId,
      deletedAt: null,
      ...(s ? { name: { contains: s, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.leaveType.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.leaveType.count({ where }),
    ]);
    return { data: rows.map((r) => this.shape(r)), total };
  }

  async findOne(businessId: number, id: number) {
    const r = await this.prisma.leaveType.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!r) throw new NotFoundException('Leave type not found');
    return this.shape(r);
  }

  async create(businessId: number, dto: CreateLeaveTypeDto) {
    await this.assertUniqueName(businessId, dto.name);
    const r = await this.prisma.leaveType.create({
      data: {
        businessId,
        name: dto.name,
        maxLeaveCount: dto.maxLeaveCount ?? null,
        leaveCountInterval: mapInterval(dto.leaveCountInterval),
        isPaid: dto.isPaid ?? true,
      },
    });
    return this.shape(r);
  }

  async update(businessId: number, id: number, dto: UpdateLeaveTypeDto) {
    await this.findOne(businessId, id);
    if (dto.name !== undefined) await this.assertUniqueName(businessId, dto.name, id);
    const data: Prisma.LeaveTypeUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.maxLeaveCount !== undefined) data.maxLeaveCount = dto.maxLeaveCount ?? null;
    if (dto.leaveCountInterval !== undefined) data.leaveCountInterval = mapInterval(dto.leaveCountInterval);
    if (dto.isPaid !== undefined) data.isPaid = dto.isPaid;
    const r = await this.prisma.leaveType.update({ where: { id }, data });
    return this.shape(r);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    await this.prisma.leaveType.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  private async assertUniqueName(businessId: number, name: string, exceptId?: number): Promise<void> {
    const found = await this.prisma.leaveType.findFirst({
      where: {
        businessId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (found) throw new ConflictException('A leave type with this name already exists');
  }
}
