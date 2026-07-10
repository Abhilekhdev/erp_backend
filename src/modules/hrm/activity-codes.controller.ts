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
import { PaginationQueryDto } from '../../common/dto/pagination.query';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { ActivityCodesService } from './activity-codes.service';
import { CreateActivityCodeDto, UpdateActivityCodeDto } from './dto/activity-code.dto';

@Controller('hrm/activity-codes')
@UseGuards(PermissionsGuard)
export class ActivityCodesController {
  constructor(private readonly activityCodes: ActivityCodesService) {}

  @Get()
  @RequirePermissions('essentials.activity_log')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.activityCodes.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('essentials.activity_log')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.activityCodes.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('essentials.activity_log')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateActivityCodeDto) {
    return this.activityCodes.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('essentials.activity_log')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateActivityCodeDto,
  ) {
    return this.activityCodes.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.activity_log')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.activityCodes.remove(user.businessId as number, id);
  }
}
