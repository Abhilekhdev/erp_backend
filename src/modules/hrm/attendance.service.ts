import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AbilityService } from '../../common/services/ability.service';
import { OWNER_ROLE } from '../../common/constants/roles';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import type {
  AttendanceQueryDto,
  ClockDto,
  CreateAttendanceDto,
  ImportAttendanceDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

type ImportRow = ImportAttendanceDto['rows'][number];

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

  /**
   * Bulk-import attendance from parsed CSV rows. Resolves email → user, shift name → shift,
   * activity-code name → id; validates each date-time; collects per-row errors and imports the rest.
   */
  async importAttendance(businessId: number, rows: ImportRow[]) {
    const [users, shifts, codes] = await Promise.all([
      this.prisma.user.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, email: true },
      }),
      this.prisma.shift.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true } }),
      this.prisma.activityCode.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, activityCode: true, activityName: true },
      }),
    ]);
    const userByEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u.id]));
    const shiftByName = new Map(shifts.map((s) => [s.name.trim().toLowerCase(), s.id]));
    const codeByName = new Map<string, number>();
    for (const c of codes) {
      if (c.activityCode) codeByName.set(c.activityCode.trim().toLowerCase(), c.id);
      if (c.activityName) codeByName.set(c.activityName.trim().toLowerCase(), c.id);
    }

    const parseDateTime = (s?: string): Date | null | 'invalid' => {
      const v = (s ?? '').trim();
      if (!v) return null;
      const d = new Date(v.includes('T') ? v : v.replace(' ', 'T'));
      return Number.isNaN(d.getTime()) ? 'invalid' : d;
    };

    const toCreate: Prisma.AttendanceCreateManyInput[] = [];
    const errors: { row: number; message: string }[] = [];

    rows.forEach((r, i) => {
      const line = i + 2; // +1 for 0-index, +1 for the header row — matches the user's spreadsheet
      const userId = userByEmail.get(r.email.trim().toLowerCase());
      if (!userId) return errors.push({ row: line, message: `No user with email "${r.email}"` });

      const clockIn = parseDateTime(r.clockInTime);
      if (clockIn === 'invalid' || clockIn === null) {
        return errors.push({ row: line, message: 'Invalid or missing clock-in time (use YYYY-MM-DD HH:MM:SS)' });
      }
      const clockOut = parseDateTime(r.clockOutTime);
      if (clockOut === 'invalid') {
        return errors.push({ row: line, message: 'Invalid clock-out time (use YYYY-MM-DD HH:MM:SS)' });
      }

      const shiftId = r.shift?.trim() ? shiftByName.get(r.shift.trim().toLowerCase()) : undefined;
      if (r.shift?.trim() && !shiftId) return errors.push({ row: line, message: `Unknown shift "${r.shift}"` });
      const activityCodeId = r.activityCode?.trim()
        ? codeByName.get(r.activityCode.trim().toLowerCase())
        : undefined;
      if (r.activityCode?.trim() && !activityCodeId) {
        return errors.push({ row: line, message: `Unknown activity code "${r.activityCode}"` });
      }

      toCreate.push({
        businessId,
        userId,
        clockInTime: clockIn,
        clockOutTime: clockOut ?? null,
        shiftId: shiftId ?? null,
        activityCodeId: activityCodeId ?? null,
        clockInNote: blank(r.clockInNote),
        clockOutNote: blank(r.clockOutNote),
        ipAddress: blank(r.ipAddress),
      });
    });

    if (toCreate.length) await this.prisma.attendance.createMany({ data: toCreate });
    return { imported: toCreate.length, failed: errors.length, errors: errors.slice(0, 50) };
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

    // Attendance prerequisites (BUG_016): the user must have BOTH an assigned shift and a work
    // location before they can mark attendance.
    const now = new Date();
    const activeShift = await this.activeUserShift(businessId, userId, now);
    const hasLocation = await this.userHasLocation(businessId, userId);
    if (!activeShift || !hasLocation) {
      throw new BadRequestException(
        'A shift and a work location must be assigned to you before you can mark attendance',
      );
    }

    // Activity code defaults from the employee's assigned activity codes (profile) — the first one,
    // and only if it still exists for this business; otherwise none.
    const activityCodeId = await this.defaultActivityCodeId(businessId, userId);
    await this.prisma.attendance.create({
      data: {
        businessId,
        userId,
        clockInTime: now,
        shiftId: activeShift.shiftId, // stamp the shift so it shows on reports (BUG_018/BUG_019)
        activityCodeId,
        clockInNote: blank(dto.note),
        clockInLocation: blank(dto.location),
        ipAddress: blank(ip),
      },
    });
    return this.clockStatus(businessId, userId);
  }

  /** The user's shift assignment whose date window covers `date` (or an open-ended one). */
  private async activeUserShift(businessId: number, userId: number, date: Date) {
    return this.prisma.userShift.findFirst({
      where: {
        businessId,
        userId,
        OR: [{ startDate: null }, { startDate: { lte: date } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: date } }] }],
      },
      orderBy: { id: 'desc' },
    });
  }

  /** True if the user has any work location: a primary location, per-location access, or access-all. */
  private async userHasLocation(businessId: number, userId: number): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
      select: { locationId: true, roles: { select: { role: { select: { name: true } } } } },
    });
    if (!user) return false;
    // The business admin (Super Admin / owner) has all-location access via the code-level bypass,
    // so they aren't required to carry an explicit location assignment.
    if (user.roles.some((r) => r.role.name === OWNER_ROLE)) return true;
    if (user.locationId) return true;
    const perLocation = await this.prisma.userLocation.count({ where: { userId } });
    if (perLocation > 0) return true;
    const accessAll = await this.prisma.userPermission.findFirst({
      where: { userId, permission: { name: 'access_all_locations' } },
      select: { userId: true },
    });
    return Boolean(accessAll);
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
      // Any clock-in that day marks the employee present for their assigned shift — records created
      // via self clock-in used to carry a null shiftId, which wrongly showed everyone as absent (BUG_019).
      this.prisma.attendance.findMany({
        where: { businessId, clockInTime: { gte: start, lte: end } },
        select: { userId: true },
      }),
    ]);
    const presentUserIds = new Set(attendances.map((a) => a.userId));
    return {
      rows: shifts.map((sh) => {
        const assigned = userShifts.filter((us) => us.shiftId === sh.id);
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
