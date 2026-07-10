import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import {
  CreateHolidayDto,
  HolidaysQueryDto,
  UpdateHolidayDto,
} from './dto/holiday.dto';
import { HolidaysService } from './holidays.service';

const HOLIDAY_ANY = [
  'essentials.add_holiday',
  'essentials.edit_holiday',
  'essentials.delete_holiday',
] as const;

@Controller('hrm/holidays')
@UseGuards(PermissionsGuard)
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get('meta')
  @RequirePermissions(...HOLIDAY_ANY)
  meta(@CurrentUser() user: AccessPayload) {
    return this.holidays.meta(user.businessId as number);
  }

  @Get()
  @RequirePermissions(...HOLIDAY_ANY)
  findAll(@CurrentUser() user: AccessPayload, @Query() query: HolidaysQueryDto) {
    return this.holidays.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions(...HOLIDAY_ANY)
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.holidays.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('essentials.add_holiday')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateHolidayDto) {
    return this.holidays.create(user.businessId as number, user.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('essentials.edit_holiday')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.holidays.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.delete_holiday')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.holidays.remove(user.businessId as number, id);
  }
}
