import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * In-app notifications behind the header bell — the port of GOURI's Laravel database
 * notifications (`HomeController@loadMoreNotifications` / `@getTotalUnreadNotifications` /
 * `@showNotification`).
 *
 * Payload contract matches the normalized shape GOURI builds in `Util::parseNotifications` +
 * `Essentials\DataController::parse_notification`: `{ msg, icon, link }`. We store that at
 * creation time instead of re-deriving it from the class name on every read, which is what made
 * the legacy path fragile.
 */

/** Page size — same as GOURI's `paginate(10)`. */
const PAGE_SIZE = 10;

export interface NotifyInput {
  businessId: number;
  /** Recipient user id(s). Duplicates and falsy values are ignored. */
  userIds: number[];
  /** Legacy class name for parity/filtering, e.g. 'NewLeaveNotification'. */
  type: string;
  /** Short HTML-free message shown in the dropdown row. */
  msg: string;
  /** Lucide icon key the frontend maps to a component (see notification.icon in the UI). */
  icon?: string;
  /** In-app route to open when the row is clicked, e.g. '/hrm/leaves'. */
  link?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create one notification per recipient. Fire-and-forget by design: a failure here must never
   * break the business action that triggered it (GOURI likewise queues/ignores notification errors),
   * so this logs and swallows instead of throwing.
   */
  async notify(input: NotifyInput): Promise<number> {
    const targets = Array.from(new Set(input.userIds.filter((id) => Number.isInteger(id) && id > 0)));
    if (targets.length === 0) return 0;

    try {
      const result = await this.prisma.notification.createMany({
        data: targets.map((userId) => ({
          businessId: input.businessId,
          userId,
          type: input.type,
          data: {
            msg: input.msg,
            icon: input.icon ?? 'bell',
            link: input.link ?? null,
          },
        })),
      });
      return result.count;
    } catch (e) {
      this.logger.error(`Failed to create '${input.type}' notification: ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * GET /notifications?page=N — newest first, 10 per page.
   *
   * GOURI marks EVERY unread notification as read when page 1 is requested (opening the bell is
   * the "read" action). That behaviour is preserved, but the read stamp is applied AFTER the rows
   * are read so the first response still renders them as unread — legacy marked them first, which
   * made the badge and the list disagree on that one render.
   */
  async list(businessId: number, userId: number, page = 1) {
    const where = { businessId, userId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.notification.count({ where }),
    ]);

    if (page === 1) await this.markAllRead(businessId, userId);

    return {
      data: rows.map((r) => this.shape(r)),
      total,
      page,
      pageSize: PAGE_SIZE,
      hasMore: page * PAGE_SIZE < total,
    };
  }

  /** GET /notifications/unread-count — drives the bell dot + the polling refresh. */
  async unreadCount(businessId: number, userId: number) {
    const total = await this.prisma.notification.count({
      where: { businessId, userId, readAt: null },
    });
    return { totalUnread: total };
  }

  /**
   * GET /notifications/:id — a single notification, marked read.
   * SECURITY: legacy `showNotification($id)` did `DatabaseNotification::find($id)` with NO
   * ownership check, so any authenticated user could read anyone's notification by UUID.
   * Scoped to the caller here.
   */
  async findOne(businessId: number, userId: number, id: string) {
    const row = await this.prisma.notification.findFirst({ where: { id, businessId, userId } });
    if (!row) throw new NotFoundException('Notification not found');
    if (!row.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
    return this.shape({ ...row, readAt: row.readAt ?? new Date() });
  }

  /** POST /notifications/mark-all-read — powers "Clear all" (a dead `href="#"` in GOURI). */
  async markAllRead(businessId: number, userId: number) {
    const result = await this.prisma.notification.updateMany({
      where: { businessId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true, marked: result.count };
  }

  /** DELETE /notifications — clear the caller's list entirely. */
  async clearAll(businessId: number, userId: number) {
    const result = await this.prisma.notification.deleteMany({ where: { businessId, userId } });
    return { success: true, deleted: result.count };
  }

  private shape(r: {
    id: string;
    type: string;
    data: unknown;
    readAt: Date | null;
    createdAt: Date;
  }) {
    const d = (r.data ?? {}) as { msg?: string; icon?: string; link?: string | null };
    return {
      id: r.id,
      type: r.type,
      msg: d.msg ?? '',
      icon: d.icon ?? 'bell',
      link: d.link ?? null,
      readAt: r.readAt,
      createdAt: r.createdAt,
    };
  }
}
