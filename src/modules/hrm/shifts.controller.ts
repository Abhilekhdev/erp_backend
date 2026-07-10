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
import { AssignUsersDto, CreateShiftDto, UpdateShiftDto } from './dto/shift.dto';
import { ShiftsService } from './shifts.service';

@Controller('hrm/shifts')
@UseGuards(PermissionsGuard)
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  @RequirePermissions('essentials.view_all_attendance')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.shifts.findAll(user.businessId as number, query);
  }

  @Get(':id')
  @RequirePermissions('essentials.view_all_attendance')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.shifts.findOne(user.businessId as number, id);
  }

  @Get(':id/users')
  @RequirePermissions('essentials.view_all_attendance')
  getUsers(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.shifts.getAssignUsers(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('essentials.view_all_attendance')
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateShiftDto) {
    return this.shifts.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('essentials.view_all_attendance')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.shifts.update(user.businessId as number, id, dto);
  }

  @Post(':id/users')
  @RequirePermissions('essentials.view_all_attendance')
  assignUsers(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignUsersDto,
  ) {
    return this.shifts.postAssignUsers(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.view_all_attendance')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.shifts.remove(user.businessId as number, id);
  }
}
