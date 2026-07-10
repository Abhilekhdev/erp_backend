import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.query';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { GeneratePayrollDto, PayrollQueryDto, PreparePayrollDto } from './dto/payroll.dto';
import { PayrollService } from './payroll.service';

const VIEW = ['essentials.view_all_payroll', 'essentials.create_payroll'] as const;

@Controller('hrm/payroll')
@UseGuards(PermissionsGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('meta')
  @RequirePermissions('essentials.create_payroll')
  meta(@CurrentUser() user: AccessPayload) {
    return this.payroll.meta(user.businessId as number);
  }

  @Get('groups')
  @RequirePermissions(...VIEW)
  listGroups(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.payroll.listGroups(user.businessId as number, query);
  }

  @Get('groups/:id')
  @RequirePermissions(...VIEW)
  getGroup(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.getGroup(user.businessId as number, id);
  }

  @Get(':id')
  @RequirePermissions(...VIEW)
  getPayroll(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.getPayroll(user.businessId as number, id);
  }

  @Get()
  @RequirePermissions(...VIEW)
  listPayrolls(@CurrentUser() user: AccessPayload, @Query() query: PayrollQueryDto) {
    return this.payroll.listPayrolls(user.businessId as number, query);
  }

  @Post('prepare')
  @RequirePermissions('essentials.create_payroll')
  prepare(@CurrentUser() user: AccessPayload, @Body() dto: PreparePayrollDto) {
    return this.payroll.prepare(user.businessId as number, dto);
  }

  @Post('generate')
  @RequirePermissions('essentials.create_payroll')
  generate(@CurrentUser() user: AccessPayload, @Body() dto: GeneratePayrollDto) {
    return this.payroll.generate(user.businessId as number, user.sub, dto);
  }

  @Post('groups/:id/pay')
  @RequirePermissions('essentials.create_payroll')
  pay(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.payGroup(user.businessId as number, id);
  }

  @Delete('groups/:id')
  @RequirePermissions('essentials.delete_payroll')
  @HttpCode(200)
  deleteGroup(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.deleteGroup(user.businessId as number, id);
  }
}
