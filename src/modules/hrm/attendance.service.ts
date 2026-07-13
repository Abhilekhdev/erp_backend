import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AbilityService } from '../../common/services/ability.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import type {
  AttendanceQueryDto,
  ClockDto,
  CreateAttendanceDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

const VIEW_ALL = 'essentials.view_all_attendance';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);
const fmtDateTime = (d: Date | null): string => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '');
const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();
const workDuration = (start: Date, end: Date | null) => {
  const mins = Math.max(0, Math.floor(((end ?? new Date()).getTime() - start.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { text: `${h}h${m ? ` ${m}m` : ''}`, minutes: mins };
};

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ability: AbilityService,
  ) {}

  async meta(businessId: number) {
    const [employees, activityCodes, shifts] = await Promise.all([
      this.prisma.user.findMany({
        where: { businessId, userType: 'USER', deletedAt: null, isCmmsnAgnt: false },
        select: { id: true, surname: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.activityCode.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, activityCode: true, activityName: true },
        orderBy: { activityName: 'asc' },
      }),
      this.prisma.shift.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, startTime: true, endTime: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      employees: employees.map((u) => ({ id: u.id, name: fullName(u) })),
      activityCodes: activityCodes.map((a) => ({ id: a.id, name: a.activityCode || a.activityName })),
      shifts: shifts.map((s) => ({ id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime })),
    };
  }

  private async activityMap(businessId: number): Promise<Map<number, string>> {
    const codes = await this.prisma.activityCode.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, activityCode: true, activityName: true },
    });
    return new Map(codes.map((c) => [c.id, c.activityCode || c.activityName]));
  }

  async findAll(businessId: number, query: AttendanceQueryDto, user: AccessPayload) {
    const canAll = await this.ability.can(user, VIEW_ALL);
    const where: Prisma.AttendanceWhereInput = {
      businessId,
      ...(canAll ? {} : { userId: user.sub }),
      ...(query.employeeId && canAll ? { userId: query.employeeId } : {}),
      ...(query.activityCodeId ? { activityCodeId: query.activityCodeId } : {}),
      ...(query.startDate && query.endDate
        ? {
            clockInTime: {
              gte: new Date(`${query.startDate}T00:00:00`),
              lte: new Date(`${query.endDate}T23:59:59`),
            },
          }
        : {}),
    };
    const [rows, total, actMap] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { clockInTime: 'desc' },
        include: { user: true, shift: true },
      }),
      this.prisma.attendance.count({ where }),
      this.activityMap(businessId),
    ]);
    const data = rows.map((a) => ({
      id: a.id,
      date: a.clockInTime ? fmtDate(a.clockInTime) : '',
      userId: a.userId,
      employee: fullName(a.user),
      clockIn: fmtDateTime(a.clockInTime),
      clockInNote: a.clockInNote ?? '',
      clockOut: fmtDateTime(a.clockOutTime),
      clockOutNote: a.clockOutNote ?? '',
      workDuration: a.clockInTime ? workDuration(a.clockInTime, a.clockOutTime).text : '',
      ipAddress: a.ipAddress ?? '',
      shiftId: a.shiftId,
      shift: a.shift?.name ?? '',
      activityCodeId: a.activityCodeId,
      activityCode: a.activityCodeId ? actMap.get(a.activityCodeId) ?? '' : '',
    }));
    return { data, total, canManageAll: canAll };
  }

  async summary(businessId: number, query: AttendanceQueryDto, user: AccessPayload) {
    const canAll = await this.ability.can(user, VIEW_ALL);
    const where: Prisma.AttendanceWhereInput = {
      businessId,
      clockOutTime: { not: null },
      ...(canAll ? {} : { userId: user.sub }),
      ...(query.employeeId && canAll ? { userId: query.employeeId } : {}),
      ...(query.startDate && query.endDate
        ? {
            clockInTime: {
              gte: new Date(`${query.startDate}T00:00:00`),
              lte: new Date(`${query.endDate}T23:59:59`),
            },
          }
        : {}),
    };
    const rows = await this.prisma.attendance.findMany({
      where,
      select: { clockInTime: true, clockOutTime: true },
    });
    const totalMinutes = rows.reduce(
      (a, r) => a + (r.clockInTime ? workDuration(r.clockInTime, r.clockOutTime).minutes : 0),
      0,
    );
    return { totalHours: Math.round((totalMinutes / 60) * 100) / 100 };
  }

  async create(businessId: number, dto: CreateAttendanceDto) {
    const a = await this.prisma.attendance.create({
      data: {
        businessId,
        userId: dto.userId,
        shiftId: dto.shiftId ?? null,
        activityCodeId: dto.activityCodeId ?? null,
        clockInTime: new Date(dto.clockInTime),
        clockOutTime: dto.clockOutTime ? new Date(dto.clockOutTime) : null,
        clockInNote: blank(dto.clockInNote),
        clockOutNote: blank(dto.clockOutNote),
        ipAddress: blank(dto.ipAddress),
      },
    });
    return { id: a.id };
  }

  async update(businessId: number, id: number, dto: UpdateAttendanceDto) {
    const found = await this.prisma.attendance.findFirst({ where: { id, businessId } });
    if (!found) throw new NotFoundException('Attendance not found');
    const data: Prisma.AttendanceUncheckedUpdateInput = {};
    if (dto.shiftId !== undefined) data.shiftId = dto.shiftId;
    if (dto.activityCodeId !== undefined) data.activityCodeId = dto.activityCodeId;
    if (dto.clockInTime !== undefined) data.clockInTime = new Date(dto.clockInTime);
    if (dto.clockOutTime !== undefined) data.clockOutTime = dto.clockOutTime ? new Date(dto.clockOutTime) : null;
    if (dto.clockInNote !== undefined) data.clockInNote = blank(dto.clockInNote);
    if (dto.clockOutNote !== undefined) data.clockOutNote = blank(dto.clockOutNote);
    await this.prisma.attendance.update({ where: { id }, data });
    return { id };
  }

  async remove(businessId: number, id: number) {
    const found = await this.prisma.attendance.findFirst({ where: { id, businessId } });
    if (!found) throw new NotFoundException('Attendance not found');
    await this.prisma.attendance.delete({ where: { id } });
    return { success: true };
  }

  async deleteSelected(businessId: number, ids: number[]) {
    await this.prisma.attendance.deleteMany({ where: { businessId, id: { in: ids.length ? ids : [0] } } });
    return { success: true };
  }

  // ── clock in / out ─────────────────────────────────────
  async clockStatus(businessId: number, userId: number) {
    const open = await this.prisma.attendance.findFirst({
      where: { businessId, userId, clockOutTime: null },
      orderBy: { clockInTime: 'desc' },
    });
    return {
      clockedIn: Boolean(open),
      attendanceId: open?.id ?? null,
      clockInTime: open?.clockInTime ? open.clockInTime.toISOString() : null,
    };
  }

  async clockIn(businessId: number, userId: number, dto: ClockDto, ip?: string) {
    const open = await this.prisma.attendance.findFirst({
      where: { businessId, userId, clockOutTime: null },
    });
    if (open) throw new BadRequestException('You are already clocked in');
    // Activity code defaults from the employee's assigned activity codes (profile) — the first one,
    // and only if it still exists for this business; otherwise none.
    const activityCodeId = await this.defaultActivityCodeId(businessId, userId);
    await this.prisma.attendance.create({
      data: {
        businessId,
        userId,
        clockInTime: new Date(),
        activityCodeId,
        clockInNote: blank(dto.note),
        clockInLocation: blank(dto.location),
        ipAddress: blank(ip),
      },
    });
    return this.clockStatus(businessId, userId);
  }

  /** The employee's default activity code (first assigned in their profile), or null if none/deleted. */
  private async defaultActivityCodeId(businessId: number, userId: number): Promise<number | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
      select: { activityCodes: true },
    });
    const assigned = Array.isArray(user?.activityCodes)
      ? (user!.activityCodes as (string | number)[]).map(Number).filter((n) => !Number.isNaN(n))
      : [];
    if (!assigned.length) return null;
    const code = await this.prisma.activityCode.findFirst({
      where: { id: assigned[0], businessId, deletedAt: null },
      select: { id: true },
    });
    return code?.id ?? null;
  }

  async clockOut(businessId: number, userId: number, dto: ClockDto) {
    const open = await this.prisma.attendance.findFirst({
      where: { businessId, userId, clockOutTime: null },
      orderBy: { clockInTime: 'desc' },
    });
    if (!open) throw new BadRequestException('You are not clocked in');
    await this.prisma.attendance.update({
      where: { id: open.id },
      data: { clockOutTime: new Date(), clockOutNote: blank(dto.note), clockOutLocation: blank(dto.location) },
    });
    return this.clockStatus(businessId, userId);
  }

  // ── by shift / by date ─────────────────────────────────
  async byShift(businessId: number, date: string) {
    const day = date || fmtDate(new Date());
    const start = new Date(`${day}T00:00:00`);
    const end = new Date(`${day}T23:59:59`);
    const [shifts, userShifts, attendances] = await Promise.all([
      this.prisma.shift.findMany({ where: { businessId, deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.userShift.findMany({
        where: { businessId, OR: [{ startDate: null }, { startDate: { lte: end } }], AND: [{ OR: [{ endDate: null }, { endDate: { gte: start } }] }] },
        include: { user: true },
      }),
      this.prisma.attendance.findMany({
        where: { businessId, clockInTime: { gte: start, lte: end }, shiftId: { not: null } },
        include: { user: true },
      }),
    ]);
    return {
      rows: shifts.map((sh) => {
        const assigned = userShifts.filter((us) => us.shiftId === sh.id);
        const presentUserIds = new Set(attendances.filter((a) => a.shiftId === sh.id).map((a) => a.userId));
        const present = assigned.filter((us) => presentUserIds.has(us.userId));
        const absent = assigned.filter((us) => !presentUserIds.has(us.userId));
        return {
          shift: sh.name,
          presentCount: present.length,
          present: present.map((us) => fullName(us.user)),
          absentCount: absent.length,
          absent: absent.map((us) => fullName(us.user)),
        };
      }),
    };
  }

  async byDate(businessId: number, startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    const [totalUsers, attendances] = await Promise.all([
      this.prisma.user.count({ where: { businessId, userType: 'USER', deletedAt: null, isCmmsnAgnt: false } }),
      this.prisma.attendance.findMany({
        where: { businessId, clockInTime: { gte: start, lte: end } },
        select: { userId: true, clockInTime: true },
      }),
    ]);
    const byDay = new Map<string, Set<number>>();
    for (const a of attendances) {
      if (!a.clockInTime) continue;
      const d = fmtDate(a.clockInTime);
      if (!byDay.has(d)) byDay.set(d, new Set());
      byDay.get(d)!.add(a.userId);
    }
    const rows = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, users]) => ({
        date,
        present: users.size,
        absent: Math.max(0, totalUsers - users.size),
      }));
    return { rows };
  }
}
