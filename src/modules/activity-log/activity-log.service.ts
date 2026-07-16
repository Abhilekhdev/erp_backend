import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AUDITED_MODELS, fieldLabel } from '../../common/audit/audit.config';
import { AbilityService } from '../../common/services/ability.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import type { ActivityLogQueryDto } from './dto/activity-log-query.dto';

/** Human wording for the actions we record. */
const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  bulk_created: 'Created (bulk)',
  bulk_updated: 'Updated (bulk)',
  bulk_deleted: 'Deleted (bulk)',
  login: 'Logged in',
  logout: 'Logged out',
  failed_login: 'Failed login',
};

export interface Change {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

@Injectable()
export class ActivityLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ability: AbilityService,
  ) {}

  /**
   * The trail, tenant-scoped and newest-first.
   *
   * Scoping is additive rather than a 403: without `activity_log.view_all` the extra AND clause
   * simply narrows results to the caller's own activity (and to entries about their own account),
   * so a crafted `?userId=` reveals nothing instead of confirming another user's entries exist.
   */
  async list(user: AccessPayload, q: ActivityLogQueryDto) {
    const and: Prisma.AuditLogWhereInput[] = [{ businessId: user.businessId }];

    if (q.userId) and.push({ userId: q.userId });
    if (q.subjectType) and.push({ subjectType: q.subjectType });
    if (q.subjectId) and.push({ subjectId: q.subjectId });
    if (q.action) and.push({ action: q.action });
    if (q.dateFrom || q.dateTo) {
      and.push({
        createdAt: {
          ...(q.dateFrom ? { gte: q.dateFrom } : {}),
          ...(q.dateTo ? { lte: endOfDay(q.dateTo) } : {}),
        },
      });
    }

    if (!(await this.ability.can(user, 'activity_log.view_all'))) {
      and.push({
        OR: [
          { userId: user.sub }, // what I did
          { subjectType: 'User', subjectId: user.sub }, // what was done to me
        ],
      });
    }

    const where: Prisma.AuditLogWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, surname: true, username: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data: rows.map((r) => this.shape(r)), total, page: q.page, pageSize: q.pageSize };
  }

  /** Filter dropdowns for the report: who can appear, and what kinds of entry exist. */
  async meta(user: AccessPayload) {
    const canAll = await this.ability.can(user, 'activity_log.view_all');
    const users = canAll
      ? await this.prisma.user.findMany({
          where: { businessId: user.businessId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, surname: true },
          orderBy: { firstName: 'asc' },
        })
      : [];

    return {
      users: users.map((u) => ({ id: u.id, name: fullName(u) })),
      actions: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
      subjectTypes: Object.entries(AUDITED_MODELS).map(([value, cfg]) => ({ value, label: cfg.label })),
      canViewAll: canAll,
    };
  }

  private shape(row: any) {
    const props = (row.properties ?? {}) as Record<string, any>;
    const changed = (props.changed ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const changes: Change[] = Object.entries(changed).map(([field, v]) => ({
      field,
      label: fieldLabel(field),
      from: v.from,
      to: v.to,
    }));

    return {
      id: Number(row.id), // BigInt is not JSON-serializable
      action: row.action,
      actionLabel: ACTION_LABELS[row.action] ?? fieldLabel(row.action),
      subjectType: row.subjectType,
      subjectTypeLabel: row.subjectType ? (AUDITED_MODELS[row.subjectType]?.label ?? row.subjectType) : null,
      subjectId: row.subjectId,
      description: row.description ?? '',
      userId: row.userId,
      userName: row.user ? fullName(row.user) : null,
      changes,
      /** Snapshot for create/delete — the UI shows it only when there is no diff to show. */
      attributes: props.attributes ?? null,
      route: props.route ?? null,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
    };
  }
}

const fullName = (u: { surname?: string | null; firstName: string; lastName?: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ');

/** A date-only `dateTo` must include that whole day, or "today" returns nothing. */
const endOfDay = (d: Date): Date => {
  const x = new Date(d);
  if (x.getHours() === 0 && x.getMinutes() === 0 && x.getSeconds() === 0) x.setHours(23, 59, 59, 999);
  return x;
};
