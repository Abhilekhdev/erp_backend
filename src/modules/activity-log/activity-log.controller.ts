import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { ActivityLogService } from './activity-log.service';
import { ActivityLogQueryDto } from './dto/activity-log-query.dto';

/**
 * One endpoint serves all three views — the global report, "activity BY a user" (`?userId=`) and
 * "activity ON a user" (`?subjectType=User&subjectId=`) — so the permission gate exists in exactly
 * one place. Either permission gets you in; the service decides how much you see.
 */
@Controller('activity-log')
@UseGuards(PermissionsGuard)
export class ActivityLogController {
  constructor(private readonly activity: ActivityLogService) {}

  @Get()
  @RequirePermissions('activity_log.view_all', 'activity_log.view_own')
  list(@CurrentUser() user: AccessPayload, @Query() query: ActivityLogQueryDto) {
    return this.activity.list(user, query);
  }

  @Get('meta')
  @RequirePermissions('activity_log.view_all', 'activity_log.view_own')
  meta(@CurrentUser() user: AccessPayload) {
    return this.activity.meta(user);
  }
}
