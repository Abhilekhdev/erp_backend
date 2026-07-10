import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import {
  ChangeLeaveStatusDto,
  CreateLeaveDto,
  SetLeaveBalancesDto,
} from './dto/leave.dto';
import { LeavesQueryDto } from './dto/leaves-query.dto';
import { LeavesService, type Requester } from './leaves.service';

const LEAVE_ACCESS = ['essentials.crud_all_leave', 'essentials.crud_own_leave'] as const;

@Controller('hrm/leaves')
@UseGuards(PermissionsGuard)
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  private req(user: AccessPayload): Requester {
    return { sub: user.sub, isBusinessAdmin: user.isBusinessAdmin };
  }

  @Get()
  @RequirePermissions(...LEAVE_ACCESS)
  findAll(@CurrentUser() user: AccessPayload, @Query() query: LeavesQueryDto) {
    return this.leaves.findAll(user.businessId as number, query, this.req(user));
  }

  @Get('meta')
  @RequirePermissions(...LEAVE_ACCESS)
  meta(@CurrentUser() user: AccessPayload) {
    return this.leaves.meta(user.businessId as number, this.req(user));
  }

  @Get('assignable')
  @RequirePermissions(...LEAVE_ACCESS)
  assignable(@CurrentUser() user: AccessPayload, @Query('userId') userId?: string) {
    return this.leaves.assignableTypes(
      user.businessId as number,
      this.req(user),
      userId ? Number(userId) : undefined,
    );
  }

  @Get('summary')
  @RequirePermissions(...LEAVE_ACCESS)
  summary(@CurrentUser() user: AccessPayload, @Query('userId') userId?: string) {
    return this.leaves.summary(
      user.businessId as number,
      this.req(user),
      userId ? Number(userId) : undefined,
    );
  }

  @Get('balances/:userId')
  @RequirePermissions('user.update')
  getBalances(@CurrentUser() user: AccessPayload, @Param('userId', ParseIntPipe) userId: number) {
    return this.leaves.getUserBalances(user.businessId as number, userId);
  }

  @Put('balances/:userId')
  @RequirePermissions('user.update')
  setBalances(
    @CurrentUser() user: AccessPayload,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: SetLeaveBalancesDto,
  ) {
    return this.leaves.setUserBalances(user.businessId as number, userId, dto);
  }

  @Post()
  @RequirePermissions(...LEAVE_ACCESS)
  create(@CurrentUser() user: AccessPayload, @Body() dto: CreateLeaveDto) {
    return this.leaves.create(user.businessId as number, this.req(user), dto);
  }

  @Post(':id/status')
  @RequirePermissions('essentials.approve_leave')
  changeStatus(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeLeaveStatusDto,
  ) {
    return this.leaves.changeStatus(user.businessId as number, id, user.sub, dto);
  }

  @Delete(':id')
  @RequirePermissions('essentials.crud_all_leave')
  @HttpCode(200)
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.leaves.remove(user.businessId as number, id);
  }
}
