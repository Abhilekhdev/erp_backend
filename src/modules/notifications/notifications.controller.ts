import { Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessPayload } from '../auth/token.service';
import { NotificationsService } from './notifications.service';

/**
 * Header-bell notifications. Every route is scoped to the caller (business + user), so no
 * permission gate is needed — a user may always read their own notifications. This is also the
 * fix for GOURI's `showNotification($id)`, which had no ownership check at all.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Paginated list (10/page, newest first). Page 1 marks everything read — matches GOURI. */
  @Get()
  list(@CurrentUser() user: AccessPayload, @Query('page') page?: string) {
    const n = Number(page);
    return this.notifications.list(
      user.businessId as number,
      user.sub,
      Number.isFinite(n) && n > 0 ? Math.floor(n) : 1,
    );
  }

  /** Unread badge count — GOURI's `/get-total-unread`, polled on an interval. */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AccessPayload) {
    return this.notifications.unreadCount(user.businessId as number, user.sub);
  }

  @Post('mark-all-read')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: AccessPayload) {
    return this.notifications.markAllRead(user.businessId as number, user.sub);
  }

  @Delete()
  @HttpCode(200)
  clearAll(@CurrentUser() user: AccessPayload) {
    return this.notifications.clearAll(user.businessId as number, user.sub);
  }

  /** Declared last so it can't shadow `unread-count`. */
  @Get(':id')
  findOne(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.notifications.findOne(user.businessId as number, user.sub, id);
  }
}
