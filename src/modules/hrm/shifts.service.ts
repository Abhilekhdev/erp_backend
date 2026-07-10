import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AssignUsersDto, CreateShiftDto, UpdateShiftDto } from './dto/shift.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const fmt = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');
const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(s: Prisma.ShiftGetPayload<object>) {
    return {
      id: s.id,
      name: s.name,
      type: s.type === 'FIXED' ? 'fixed_shift' : 'flexible_shift',
      typeLabel: s.type === 'FIXED' ? 'Fixed shift' : 'Flexible shift',
      startTime: s.startTime ?? '',
      endTime: s.endTime ?? '',
      holidays: Array.isArray(s.holidays) ? (s.holidays as string[]) : [],
      isAllowedAutoClockout: s.isAllowedAutoClockout,
      autoClockoutTime: s.autoClockoutTime ?? '',
    };
  }

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const s = query.search.trim();
    const where: Prisma.ShiftWhereInput = {
      businessId,
      deletedAt: null,
      ...(s ? { name: { contains: s, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.shift.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.shift.count({ where }),
    ]);
    return { data: rows.map((r) => this.shape(r)), total };
  }

  async findOne(businessId: number, id: number) {
    const s = await this.prisma.shift.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!s) throw new NotFoundException('Shift not found');
    return this.shape(s);
  }

  async create(businessId: number, dto: CreateShiftDto) {
    const flexible = dto.type === 'flexible_shift';
    const s = await this.prisma.shift.create({
      data: {
        businessId,
        name: dto.name,
        type: flexible ? 'FLEXIBLE' : 'FIXED',
        startTime: flexible ? null : blank(dto.startTime),
        endTime: flexible ? null : blank(dto.endTime),
        holidays: dto.holidays ?? [],
        isAllowedAutoClockout: dto.isAllowedAutoClockout ?? false,
        autoClockoutTime: dto.isAllowedAutoClockout ? blank(dto.autoClockoutTime) : null,
      },
    });
    return this.shape(s);
  }

  async update(businessId: number, id: number, dto: UpdateShiftDto) {
    await this.findOne(businessId, id);
    const data: Prisma.ShiftUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) {
      const flexible = dto.type === 'flexible_shift';
      data.type = flexible ? 'FLEXIBLE' : 'FIXED';
      if (flexible) {
        data.startTime = null;
        data.endTime = null;
      }
    }
    if (dto.startTime !== undefined && dto.type !== 'flexible_shift') data.startTime = blank(dto.startTime);
    if (dto.endTime !== undefined && dto.type !== 'flexible_shift') data.endTime = blank(dto.endTime);
    if (dto.holidays !== undefined) data.holidays = dto.holidays;
    if (dto.isAllowedAutoClockout !== undefined) {
      data.isAllowedAutoClockout = dto.isAllowedAutoClockout;
      if (!dto.isAllowedAutoClockout) data.autoClockoutTime = null;
    }
    if (dto.autoClockoutTime !== undefined) data.autoClockoutTime = blank(dto.autoClockoutTime);
    const s = await this.prisma.shift.update({ where: { id }, data });
    return this.shape(s);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    await this.prisma.shift.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** Users + their assignment for this shift (for the "Assign users" modal). */
  async getAssignUsers(businessId: number, shiftId: number) {
    await this.findOne(businessId, shiftId);
    const [users, assignments] = await Promise.all([
      this.prisma.user.findMany({
        where: { businessId, userType: 'USER', deletedAt: null, isCmmsnAgnt: false },
        select: { id: true, surname: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.userShift.findMany({ where: { businessId, shiftId } }),
    ]);
    const map = new Map(assignments.map((a) => [a.userId, a]));
    return users.map((u) => ({
      userId: u.id,
      name: fullName(u),
      isAdded: map.has(u.id),
      startDate: fmt(map.get(u.id)?.startDate ?? null),
      endDate: fmt(map.get(u.id)?.endDate ?? null),
    }));
  }

  async postAssignUsers(businessId: number, shiftId: number, dto: AssignUsersDto) {
    await this.findOne(businessId, shiftId);
    await this.prisma.$transaction(async (tx) => {
      for (const a of dto.assignments) {
        if (a.isAdded) {
          const existing = await tx.userShift.findFirst({
            where: { businessId, shiftId, userId: a.userId },
          });
          const dates = {
            startDate: a.startDate ? new Date(a.startDate) : null,
            endDate: a.endDate ? new Date(a.endDate) : null,
          };
          if (existing) await tx.userShift.update({ where: { id: existing.id }, data: dates });
          else await tx.userShift.create({ data: { businessId, shiftId, userId: a.userId, ...dates } });
        } else {
          await tx.userShift.deleteMany({ where: { businessId, shiftId, userId: a.userId } });
        }
      }
    });
    return { success: true };
  }
}
