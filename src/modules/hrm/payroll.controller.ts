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
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.query';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { AddPayrollPaymentsDto } from './dto/payroll-payment.dto';
import {
  GeneratePayrollDto,
  PayrollQueryDto,
  PreparePayrollDto,
  UpdatePayrollGroupDto,
} from './dto/payroll.dto';
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

  /** Per-employee rows + amounts due for the group's Add-Payment screen. */
  @Get('groups/:id/payment-form')
  @RequirePermissions('essentials.create_payroll')
  paymentForm(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.getGroupPaymentForm(user.businessId as number, id);
  }

  /** Full payslip data (employee, lines, attendance/leave figures, YTD, payments). */
  @Get(':id/payslip')
  @RequirePermissions(...VIEW)
  payslip(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.getPayslip(user.businessId as number, id, user);
  }

  /** Server-rendered payslip PDF (GOURI generatePayslip/downloadPayslip via mpdf). */
  @Get(':id/payslip/pdf')
  @RequirePermissions(...VIEW)
  async payslipPdf(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.payroll.getPayslipPdf(user.businessId as number, id, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  /** Email the payslip (PDF attached) to the employee — GOURI sendPayrollEmail. */
  @Post(':id/send-email')
  @RequirePermissions('essentials.create_payroll')
  @HttpCode(200)
  sendEmail(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.sendPayslipEmail(user.businessId as number, id, user);
  }

  @Get(':id/payments')
  @RequirePermissions(...VIEW)
  listPayments(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.listPayments(user.businessId as number, id, user);
  }

  @Get(':id')
  @RequirePermissions(...VIEW)
  getPayroll(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.getPayroll(user.businessId as number, id, user);
  }

  @Get()
  @RequirePermissions(...VIEW)
  listPayrolls(@CurrentUser() user: AccessPayload, @Query() query: PayrollQueryDto) {
    return this.payroll.listPayrolls(user.businessId as number, query, user);
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

  /** Record payments (one row per employee) — GOURI's postAddPayment. */
  @Post('payments')
  @RequirePermissions('essentials.create_payroll')
  @HttpCode(200)
  addPayments(@CurrentUser() user: AccessPayload, @Body() dto: AddPayrollPaymentsDto) {
    return this.payroll.addPayments(user.businessId as number, user.sub, dto);
  }

  @Delete('payments/:id')
  @RequirePermissions('essentials.create_payroll')
  @HttpCode(200)
  deletePayment(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.deletePayment(user.businessId as number, id);
  }

  @Patch('groups/:id')
  @RequirePermissions('essentials.update_payroll')
  updateGroup(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePayrollGroupDto,
  ) {
    return this.payroll.updateGroup(user.businessId as number, id, dto);
  }

  @Delete('groups/:id')
  @RequirePermissions('essentials.delete_payroll')
  @HttpCode(200)
  deleteGroup(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.deleteGroup(user.businessId as number, id);
  }

  @Delete(':id')
  @RequirePermissions('essentials.delete_payroll')
  @HttpCode(200)
  deletePayroll(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payroll.deletePayroll(user.businessId as number, id);
  }
}
