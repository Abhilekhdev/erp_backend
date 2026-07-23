import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { AccountReportsService } from './account-reports.service';

@Controller('accounts/reports')
@UseGuards(PermissionsGuard)
export class AccountReportsController {
  constructor(private readonly reports: AccountReportsService) {}

  @Get('balance-sheet')
  @RequirePermissions('account.access')
  balanceSheet(@CurrentUser() user: AccessPayload) {
    return this.reports.balanceSheet(user.businessId as number);
  }

  @Get('trial-balance')
  @RequirePermissions('account.access')
  trialBalance(@CurrentUser() user: AccessPayload) {
    return this.reports.trialBalance(user.businessId as number);
  }

  @Get('payment-report')
  @RequirePermissions('account.access')
  paymentReport(
    @CurrentUser() user: AccessPayload,
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('method') method?: string,
  ) {
    return this.reports.paymentAccountReport(user.businessId as number, {
      accountId: accountId ? Number(accountId) : undefined,
      from,
      to,
      method,
    });
  }
}
