import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessPayload } from '../auth/token.service';
import { CalendarService } from './calendar.service';
import { CalendarQueryDto } from './dto/calendar-query.dto';

/**
 * Calendar — the port of GOURI's `/calendar` (`HomeController@getCalendar`), which serves both the
 * page data and the FullCalendar AJAX feed from one action. Split here into `meta` + `events`.
 *
 * No permission gate, matching legacy: the route is auth-only and every query is scoped to the
 * caller's business, with non-admins pinned to their own user id inside the service.
 */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('meta')
  meta(@CurrentUser() user: AccessPayload) {
    return this.calendar.meta(user);
  }

  @Get('events')
  events(@CurrentUser() user: AccessPayload, @Query() query: CalendarQueryDto) {
    return this.calendar.events(user, query);
  }
}
