import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AbilityService } from '../../common/services/ability.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import type { ChangeLeaveStatusDto, CreateLeaveDto, SetLeaveBalancesDto } from './dto/leave.dto';
import type { LeavesQueryDto } from './dto/leaves-query.dto';

const CRUD_ALL = 'essentials.crud_all_leave';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const fmt = (d: Date): string => d.toISOString().slice(0, 10);
const daysBetween = (start: Date, end: Date): number =>
  Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();
const mapStatus = (s: string): 'PENDING' | 'APPROVED' | 'CANCELLED' =>
  s.toUpperCase() as 'PENDING' | 'APPROVED' | 'CANCELLED';
// GOURI renders the DB value `cancelled` as "Rejected".
const statusLabel = (s: string): string =>
  s === 'CANCELLED' ? 'Rejected' : s === 'APPROVED' ? 'Approved' : 'Pending';

@Injectable()
export class LeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ability: AbilityService,
  ) {}

  /**
   * The user ids an "own-leave" (non-crud_all) user may see: themselves + every recursive subordinate
   * (users whose `parentId` chain leads back to them). Mirrors GOURI's `managerUsers` + self scoping.
   */
  private async ownScopeUserIds(businessId: number, userId: number): Promise<number[]> {
    const all = await this.prisma.user.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const childrenOf = new Map<number, number[]>();
    for (const u of all) {
      if (u.parentId != null) {
        const list = childrenOf.get(u.parentId) ?? [];
        list.push(u.id);
        childrenOf.set(u.parentId, list);
      }
    }
    const result = new Set<number>([userId]);
    const stack = [userId];
    while (stack.length) {
      const cur = stack.pop() as number;
      for (const child of childrenOf.get(cur) ?? []) {
        if (!result.has(child)) {
          result.add(child);
          stack.push(child);
        }
      }
    }
    return [...result];
  }

  // ── dropdowns / entitlements ───────────────────────────
  async meta(businessId: number, user: AccessPayload) {
    const canAll = await this.ability.can(user, CRUD_ALL);
    const [leaveTypes, employees] = await Promise.all([
      this.prisma.leaveType.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      canAll
        ? this.prisma.user.findMany({
            where: { businessId, userType: 'USER', deletedAt: null, isCmmsnAgnt: false },
            select: { id: true, surname: true, firstName: true, lastName: true },
            orderBy: { firstName: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    return {
      leaveTypes,
      employees: employees.map((u) => ({ id: u.id, name: fullName(u) })),
      statuses: [
        { value: 'pending', label: 'Pending' },
        { value: 'approved', label: 'Approved' },
        { value: 'cancelled', label: 'Rejected' },
      ],
      canManageAll: canAll,
    };
  }

  /** Leave types the target user is entitled to (has a balance row) — the Add-Leave dropdown source. */
  async assignableTypes(businessId: number, user: AccessPayload, userId?: number) {
    const canAll = await this.ability.can(user, CRUD_ALL);
    const targetId = userId && canAll ? userId : user.sub;
    const balances = await this.prisma.userLeaveBalance.findMany({
      where: { businessId, userId: targetId },
      include: { leaveType: true },
    });
    return balances
      .filter((b) => !b.leaveType.deletedAt)
      .map((b) => ({ id: b.leaveTypeId, name: b.leaveType.name, balance: Number(b.balance) }));
  }

  /** All leave types + this user's balance (0 if unassigned) — for the entitlements editor. */
  async getUserBalances(businessId: number, userId: number) {
    const [types, balances] = await Promise.all([
      this.prisma.leaveType.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.userLeaveBalance.findMany({ where: { businessId, userId } }),
    ]);
    const map = new Map(balances.map((b) => [b.leaveTypeId, Number(b.balance)]));
    return types.map((t) => ({
      leaveTypeId: t.id,
      name: t.name,
      balance: map.get(t.id) ?? 0,
      assigned: map.has(t.id),
    }));
  }

  async setUserBalances(businessId: number, userId: number, dto: SetLeaveBalancesDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, businessId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');

    const provided = dto.balances.filter((b) => b.balance !== undefined);
    const typeIds = provided.map((b) => b.leaveTypeId);
    if (typeIds.length) {
      const count = await this.prisma.leaveType.count({
        where: { businessId, id: { in: typeIds }, deletedAt: null },
      });
      if (count !== new Set(typeIds).size) throw new BadRequestException('Invalid leave type');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const b of provided) {
        await tx.userLeaveBalance.upsert({
          where: { userId_leaveTypeId: { userId, leaveTypeId: b.leaveTypeId } },
          create: { businessId, userId, leaveTypeId: b.leaveTypeId, balance: b.balance as number },
          update: { balance: b.balance as number },
        });
      }
      // Drop entitlements the caller removed.
      await tx.userLeaveBalance.deleteMany({
        where: { userId, leaveTypeId: { notIn: typeIds.length ? typeIds : [0] } },
      });
    });
    return this.getUserBalances(businessId, userId);
  }

  // ── leaves list / apply / status / delete ──────────────
  async findAll(businessId: number, query: LeavesQueryDto, user: AccessPayload) {
    const canAll = await this.ability.can(user, CRUD_ALL);
    const s = query.search?.trim();
    const ownIds = canAll ? [] : await this.ownScopeUserIds(businessId, user.sub);
    const where: Prisma.LeaveWhereInput = {
      businessId,
      ...(canAll ? {} : { userId: { in: ownIds } }),
      ...(query.userId && canAll ? { userId: query.userId } : {}),
      ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
      ...(query.status ? { status: mapStatus(query.status) } : {}),
      ...(query.startDate && query.endDate
        ? { startDate: { lte: new Date(query.endDate) }, endDate: { gte: new Date(query.startDate) } }
        : {}),
      ...(s
        ? {
            OR: [
              { refNo: { contains: s, mode: 'insensitive' } },
              { reason: { contains: s, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leave.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { startDate: 'desc' },
        include: { leaveType: true, user: true },
      }),
      this.prisma.leave.count({ where }),
    ]);
    return {
      data: rows.map((l) => this.shape(l)),
      total,
      canManageAll: canAll,
    };
  }

  async findOne(businessId: number, id: number) {
    const l = await this.prisma.leave.findFirst({
      where: { id, businessId },
      include: { leaveType: true, user: true },
    });
    if (!l) throw new NotFoundException('Leave not found');
    return this.shape(l);
  }

  private shape(l: Prisma.LeaveGetPayload<{ include: { leaveType: true; user: true } }>) {
    return {
      id: l.id,
      refNo: l.refNo,
      leaveTypeId: l.leaveTypeId,
      leaveType: l.leaveType.name,
      userId: l.userId,
      employee: fullName(l.user),
      startDate: fmt(l.startDate),
      endDate: fmt(l.endDate),
      days: daysBetween(l.startDate, l.endDate),
      reason: l.reason ?? '',
      status: l.status.toLowerCase(),
      statusLabel: statusLabel(l.status),
      statusNote: l.statusNote ?? '',
    };
  }

  async create(businessId: number, user: AccessPayload, dto: CreateLeaveDto) {
    const canAll = await this.ability.can(user, CRUD_ALL);
    const targetUserId = dto.userId && canAll ? dto.userId : user.sub;
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id: dto.leaveTypeId, businessId, deletedAt: null },
    });
    if (!leaveType) throw new BadRequestException('Selected leave type is invalid');

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('End date must be on or after the start date');
    const days = daysBetween(start, end);

    let balanceRow: { id: number; balance: Prisma.Decimal } | null = null;
    if (leaveType.isPaid) {
      balanceRow = await this.prisma.userLeaveBalance.findUnique({
        where: { userId_leaveTypeId: { userId: targetUserId, leaveTypeId: leaveType.id } },
        select: { id: true, balance: true },
      });
      const bal = balanceRow ? Number(balanceRow.balance) : 0;
      if (bal < days) {
        throw new BadRequestException(
          `Insufficient leave balance — ${bal} day(s) available, ${days} requested`,
        );
      }
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leave.create({
        data: {
          businessId,
          leaveTypeId: leaveType.id,
          userId: targetUserId,
          startDate: start,
          endDate: end,
          reason: blank(dto.reason),
          status: 'PENDING',
        },
      });
      await tx.leave.update({
        where: { id: created.id },
        data: { refNo: `LV${created.id.toString().padStart(4, '0')}` },
      });
      if (leaveType.isPaid && balanceRow) {
        await tx.userLeaveBalance.update({
          where: { id: balanceRow.id },
          data: { balance: { decrement: days } },
        });
      }
      return created.id;
    });
    return this.findOne(businessId, id);
  }

  async changeStatus(
    businessId: number,
    id: number,
    requesterId: number,
    dto: ChangeLeaveStatusDto,
  ) {
    const leave = await this.prisma.leave.findFirst({
      where: { id, businessId },
      include: { leaveType: true },
    });
    if (!leave) throw new NotFoundException('Leave not found');

    const newStatus = mapStatus(dto.status);
    const days = daysBetween(leave.startDate, leave.endDate);

    await this.prisma.$transaction(async (tx) => {
      // Cancelling/rejecting a paid leave restores the balance.
      if (newStatus === 'CANCELLED' && leave.status !== 'CANCELLED' && leave.leaveType.isPaid) {
        await tx.userLeaveBalance.updateMany({
          where: { userId: leave.userId, leaveTypeId: leave.leaveTypeId },
          data: { balance: { increment: days } },
        });
      }
      // Re-activating a previously cancelled paid leave re-deducts.
      if (newStatus !== 'CANCELLED' && leave.status === 'CANCELLED' && leave.leaveType.isPaid) {
        await tx.userLeaveBalance.updateMany({
          where: { userId: leave.userId, leaveTypeId: leave.leaveTypeId },
          data: { balance: { decrement: days } },
        });
      }
      await tx.leave.update({
        where: { id },
        data: {
          status: newStatus,
          statusNote: blank(dto.statusNote),
          changedBy: requesterId,
          changedAt: new Date(),
        },
      });
    });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    const leave = await this.prisma.leave.findFirst({
      where: { id, businessId },
      include: { leaveType: true },
    });
    if (!leave) throw new NotFoundException('Leave not found');
    const days = daysBetween(leave.startDate, leave.endDate);

    await this.prisma.$transaction(async (tx) => {
      // A still-active paid leave gives its days back on delete.
      if (leave.status !== 'CANCELLED' && leave.leaveType.isPaid) {
        await tx.userLeaveBalance.updateMany({
          where: { userId: leave.userId, leaveTypeId: leave.leaveTypeId },
          data: { balance: { increment: days } },
        });
      }
      await tx.leave.delete({ where: { id } });
    });
    return { success: true };
  }

  async summary(businessId: number, user: AccessPayload, userId?: number) {
    const canAll = await this.ability.can(user, CRUD_ALL);
    const targetId = userId && canAll ? userId : user.sub;
    const [balances, leaves] = await Promise.all([
      this.prisma.userLeaveBalance.findMany({
        where: { businessId, userId: targetId },
        include: { leaveType: true },
      }),
      this.prisma.leave.findMany({ where: { businessId, userId: targetId } }),
    ]);
    const sumDays = (typeId: number, status: string) =>
      leaves
        .filter((l) => l.leaveTypeId === typeId && l.status === status)
        .reduce((a, l) => a + daysBetween(l.startDate, l.endDate), 0);

    return {
      rows: balances.map((b) => ({
        leaveType: b.leaveType.name,
        pending: sumDays(b.leaveTypeId, 'PENDING'),
        approved: sumDays(b.leaveTypeId, 'APPROVED'),
        rejected: sumDays(b.leaveTypeId, 'CANCELLED'),
        balance: Number(b.balance),
        max: b.leaveType.maxLeaveCount,
        interval: b.leaveType.leaveCountInterval ? b.leaveType.leaveCountInterval.toLowerCase() : null,
      })),
    };
  }
}
