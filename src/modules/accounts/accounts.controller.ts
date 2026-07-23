import {
  Body,
  Controller,
  Delete,
  Get,
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
import { AccountsService } from './accounts.service';
import {
  DepositDto,
  FundTransferDto,
  SaveAccountDto,
  UpdateAccountTransactionDto,
} from './dto/accounts.dto';

@Controller('accounts')
@UseGuards(PermissionsGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  // ── static routes first (before :id) ──
  @Get()
  @RequirePermissions('account.access')
  list(@CurrentUser() user: AccessPayload, @Query('includeClosed') includeClosed?: string) {
    return this.accounts.findAll(user.businessId as number, includeClosed === 'true');
  }

  @Get('dropdown')
  @RequirePermissions('account.access')
  dropdown(@CurrentUser() user: AccessPayload) {
    return this.accounts.dropdown(user.businessId as number);
  }

  @Get('cash-flow')
  @RequirePermissions('account.access')
  cashFlow(
    @CurrentUser() user: AccessPayload,
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.accounts.cashFlow(user.businessId as number, {
      accountId: accountId ? Number(accountId) : undefined,
      from,
      to,
    });
  }

  @Post()
  @RequirePermissions('account.access')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveAccountDto) {
    return this.accounts.create(user.businessId as number, user.sub, dto);
  }

  @Post('fund-transfer')
  @RequirePermissions('account.access')
  fundTransfer(@CurrentUser() user: AccessPayload, @Body() dto: FundTransferDto) {
    return this.accounts.fundTransfer(user.businessId as number, user.sub, dto);
  }

  @Post('deposit')
  @RequirePermissions('account.access')
  deposit(@CurrentUser() user: AccessPayload, @Body() dto: DepositDto) {
    return this.accounts.deposit(user.businessId as number, user.sub, dto);
  }

  // ── :id routes ──
  @Get(':id')
  @RequirePermissions('account.access')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.accounts.findOne(user.businessId as number, id);
  }

  @Get(':id/balance')
  @RequirePermissions('account.access')
  balance(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.accounts.getAccountBalance(user.businessId as number, id);
  }

  @Get(':id/book')
  @RequirePermissions('account.access')
  book(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.accounts.accountBook(user.businessId as number, id);
  }

  @Put(':id')
  @RequirePermissions('account.access')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveAccountDto,
  ) {
    return this.accounts.update(user.businessId as number, id, dto);
  }

  @Post(':id/close')
  @RequirePermissions('account.access')
  close(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.accounts.setClosed(user.businessId as number, id, true);
  }

  @Post(':id/activate')
  @RequirePermissions('account.access')
  activate(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.accounts.setClosed(user.businessId as number, id, false);
  }

  @Delete(':id')
  @RequirePermissions('account.access')
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.accounts.remove(user.businessId as number, id);
  }
}

@Controller('account-transactions')
@UseGuards(PermissionsGuard)
export class AccountTransactionsController {
  constructor(private readonly accounts: AccountsService) {}

  @Put(':id')
  @RequirePermissions('edit_account_transaction')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAccountTransactionDto,
  ) {
    return this.accounts.updateAccountTransaction(user.businessId as number, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('delete_account_transaction')
  remove(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.accounts.deleteAccountTransaction(user.businessId as number, id);
  }
}
