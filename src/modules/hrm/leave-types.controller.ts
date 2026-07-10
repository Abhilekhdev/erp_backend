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
import { CreateLeaveTypeDto, UpdateLeaveTypeDto } from './dto/leave-type.dto';
import { LeaveTypesService } from './leave-types.service';

@Controller('hrm/leave-types')
@UseGuards(PermissionsGuard)
export class LeaveTypesController {
  constructor(private readonly leaveTypes: LeaveTypesService) {}

  @Get()
  @RequirePermissions('essentials.crud_leave_type')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.leaveTypes.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('essentials.crud_leave_type')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.leaveTypes.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('essentials.crud_leave_type')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateLeaveTypeDto) {
    return this.leaveTypes.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('essentials.crud_leave_type')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.leaveTypes.update(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.crud_leave_type')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.leaveTypes.remove(user.businessId as number, id);
  }
}
