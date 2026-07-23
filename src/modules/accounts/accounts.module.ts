import { Module } from '@nestjs/common';
import { AccountPostingService } from './account-posting.service';
import { AccountReportsController } from './account-reports.controller';
import { AccountReportsService } from './account-reports.service';
import { AccountTypesController } from './account-types.controller';
import { AccountTypesService } from './account-types.service';
import { AccountsController, AccountTransactionsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  controllers: [
    AccountsController,
    AccountTransactionsController,
    AccountTypesController,
    AccountReportsController,
  ],
  providers: [AccountsService, AccountTypesService, AccountReportsService, AccountPostingService],
  // AccountPostingService is consumed by the transaction modules (purchases, sells…) to post
  // an account_transactions row whenever a payment carries an account_id.
  exports: [AccountPostingService],
})
export class AccountsModule {}
