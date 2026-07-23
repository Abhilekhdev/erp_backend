import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

/**
 * Reports — the port of GOURI's `ReportController`. Each screen keeps its exact legacy permission.
 * `meta` supplies the shared filter dropdowns (locations, categories, brands, units, tax rates,
 * users, suppliers, customers) and is readable by anyone who can open any report.
 */
const ANY_REPORT = [
  'profit_loss_report.view',
  'purchase_n_sell_report.view',
  'tax_report.view',
  'stock_report.view',
  'trending_product_report.view',
  'register_report.view',
  'expense_report.view',
  'sales_representative.view',
  'contacts_report.view',
] as const;

@Controller('reports')
@UseGuards(PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('meta')
  @RequirePermissions(...ANY_REPORT)
  meta(@CurrentUser() user: AccessPayload) {
    return this.reports.meta(user.businessId as number);
  }

  @Get('profit-loss')
  @RequirePermissions('profit_loss_report.view')
  profitLoss(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.profitLoss(user.businessId as number, q);
  }

  @Get('purchase-sale')
  @RequirePermissions('purchase_n_sell_report.view')
  purchaseSale(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.purchaseSale(user.businessId as number, q);
  }

  @Get('tax')
  @RequirePermissions('tax_report.view')
  tax(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.tax(user.businessId as number, q);
  }

  @Get('stock')
  @RequirePermissions('stock_report.view')
  stock(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.stock(user.businessId as number, q);
  }

  @Get('trending')
  @RequirePermissions('trending_product_report.view')
  trending(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.trending(user.businessId as number, q);
  }

  @Get('items')
  @RequirePermissions('purchase_n_sell_report.view')
  items(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.items(user.businessId as number, q);
  }

  @Get('expense')
  @RequirePermissions('expense_report.view')
  expense(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.expense(user.businessId as number, q);
  }

  @Get('sales-rep')
  @RequirePermissions('sales_representative.view')
  salesRep(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.salesRep(user.businessId as number, q);
  }

  @Get('customer-supplier')
  @RequirePermissions('contacts_report.view')
  customerSupplier(@CurrentUser() user: AccessPayload, @Query() q: ReportQueryDto) {
    return this.reports.customerSupplier(user.businessId as number, q);
  }
}
