import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { AttendanceService } from './attendance.service';
import {
  AttendanceQueryDto,
  ClockDto,
  CreateAttendanceDto,
  DeleteSelectedDto,
  ImportAttendanceDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

const VIEW = ['essentials.view_all_attendance', 'essentials.view_own_attendance'] as const;

@Controller('hrm/attendance')
@UseGuards(PermissionsGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('meta')
  @RequirePermissions(...VIEW)
  meta(@CurrentUser() user: AccessPayload) {
    return this.attendance.meta(user.businessId as number);
  }

  @Get('summary')
  @RequirePermissions(...VIEW)
  summary(@CurrentUser() user: AccessPayload, @Query() query: AttendanceQueryDto) {
    return this.attendance.summary(user.businessId as number, query, user);
  }

  @Get('clock-status')
  @RequirePermissions(...VIEW, 'essentials.allow_users_for_attendance_from_web')
  clockStatus(@CurrentUser() user: AccessPayload) {
    return this.attendance.clockStatus(user.businessId as number, user.sub);
  }

  @Post('clock-in')
  @RequirePermissions('essentials.allow_users_for_attendance_from_web')
  clockIn(@CurrentUser() user: AccessPayload, @Body() dto: ClockDto, @Ip() ip: string) {
    return this.attendance.clockIn(user.businessId as number, user.sub, dto, ip);
  }

  @Post('clock-out')
  @RequirePermissions('essentials.allow_users_for_attendance_from_web')
  clockOut(@CurrentUser() user: AccessPayload, @Body() dto: ClockDto) {
    return this.attendance.clockOut(user.businessId as number, user.sub, dto);
  }

  @Get('by-shift')
  @RequirePermissions('essentials.view_all_attendance')
  byShift(@CurrentUser() user: AccessPayload, @Query('date') date?: string) {
    return this.attendance.byShift(user.businessId as number, date ?? '');
  }

  @Get('by-date')
  @RequirePermissions('essentials.view_all_attendance')
  byDate(
    @CurrentUser() user: AccessPayload,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.attendance.byDate(user.businessId as number, startDate, endDate);
  }

  @Post('delete-selected')
  @RequirePermissions('essentials.delete_attendance')
  @HttpCode(200)
  deleteSelected(@CurrentUser() user: AccessPayload, @Body() dto: DeleteSelectedDto) {
    return this.attendance.deleteSelected(user.businessId as number, dto.ids);
  }

  @Post('import')
  @RequirePermissions('essentials.add_attendance')
  @HttpCode(200)
  import(@CurrentUser() user: AccessPayload, @Body() dto: ImportAttendanceDto) {
    return this.attendance.importAttendance(user.businessId as number, dto.rows);
  }

  @Get()
  @RequirePermissions(...VIEW)
  findAll(@CurrentUser() user: AccessPayload, @Query() query: AttendanceQueryDto) {
    return this.attendance.findAll(user.businessId as number, query, user);
  }

  @Post()
  @RequirePermissions('essentials.add_attendance')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateAttendanceDto) {
    return this.attendance.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('essentials.edit_attendance')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.attendance.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.delete_attendance')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.attendance.remove(user.businessId as number, id);
  }
}
