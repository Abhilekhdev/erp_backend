import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.query';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { SaveSalesTargetsDto } from './dto/sales-target.dto';
import { SalesTargetsService } from './sales-targets.service';

@Controller('hrm/sales-targets')
@UseGuards(PermissionsGuard)
export class SalesTargetsController {
  constructor(private readonly salesTargets: SalesTargetsService) {}

  @Get()
  @RequirePermissions('essentials.access_sales_target')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.salesTargets.findAll(user.businessId as number, query);
  }

  @Get(':userId')
  @RequirePermissions('essentials.access_sales_target')
  getUser(@CurrentUser() user: AccessPayload, @Param('userId', ParseIntPipe) userId: number) {
    return this.salesTargets.getUserTargets(user.businessId as number, userId);
  }

  @Put(':userId')
  @RequirePermissions('essentials.access_sales_target')
  save(
    @CurrentUser() user: AccessPayload,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: SaveSalesTargetsDto,
  ) {
    return this.salesTargets.saveUserTargets(user.businessId as number, userId, dto);
  }
}
