import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type {
  DepositDto,
  FundTransferDto,
  SaveAccountDto,
  UpdateAccountTransactionDto,
} from './dto/accounts.dto';

/** sub_types a user may create/edit/delete by hand (auto payment rows have sub_type NULL). */
const MANUAL_SUB_TYPES = ['OPENING_BALANCE', 'FUND_TRANSFER', 'DEPOSIT'] as const;

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** balance = Σ(credit) − Σ(debit) over non-deleted rows, per account (GOURI's SUM(IF...)). */
  private async balancesFor(accountIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (accountIds.length === 0) return map;
    const groups = await this.prisma.accountTransaction.groupBy({
      by: ['accountId', 'type'],
      where: { accountId: { in: accountIds }, deletedAt: null },
      _sum: { amount: true },
    });
    for (const g of groups) {
      const signed = (g.type === 'CREDIT' ? 1 : -1) * Number(g._sum.amount ?? 0);
      map.set(g.accountId, (map.get(g.accountId) ?? 0) + signed);
    }
    return map;
  }

  // ── accounts CRUD ───────────────────────────────────────
  async findAll(businessId: number, includeClosed = false) {
    const accounts = await this.prisma.account.findMany({
      where: { businessId, deletedAt: null, ...(includeClosed ? {} : { isClosed: false }) },
      include: { accountType: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    const balances = await this.balancesFor(accounts.map((a) => a.id));

    // Count payments not yet linked to any account (GOURI's "unlinked" badge on the index).
    const unlinkedCount = await this.prisma.transactionPayment.count({
      where: { businessId, accountId: null, parentId: null, method: { not: 'advance' } },
    });

    return {
      data: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        accountNumber: a.accountNumber,
        accountType: a.accountType?.name ?? null,
        accountTypeId: a.accountTypeId,
        note: a.note,
        isClosed: a.isClosed,
        balance: balances.get(a.id) ?? 0,
      })),
      unlinkedPaymentCount: unlinkedCount,
    };
  }

  /** GET /accounts/dropdown — open accounts for the payment / transfer pickers. */
  async dropdown(businessId: number) {
    const rows = await this.prisma.account.findMany({
      where: { businessId, deletedAt: null, isClosed: false },
      select: { id: true, name: true, accountNumber: true },
      orderBy: { name: 'asc' },
    });
    return { data: rows.map((r) => ({ id: r.id, name: `${r.name} - ${r.accountNumber}` })) };
  }

  private async requireAccount(businessId: number, id: number) {
    const account = await this.prisma.account.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async getAccountBalance(businessId: number, id: number) {
    await this.requireAccount(businessId, id);
    const balances = await this.balancesFor([id]);
    return { balance: balances.get(id) ?? 0 };
  }

  async create(businessId: number, createdBy: number, dto: SaveAccountDto) {
    if (dto.accountTypeId) await this.assertTypeInBusiness(businessId, dto.accountTypeId);
    const account = await this.prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          businessId,
          createdBy,
          name: dto.name,
          accountNumber: dto.accountNumber,
          accountTypeId: dto.accountTypeId ?? null,
          accountDetails: (dto.accountDetails ?? []) as Prisma.InputJsonValue,
          note: dto.note ?? null,
        },
      });
      // Opening balance = one credit row (GOURI store()).
      if (dto.openingBalance && dto.openingBalance !== 0) {
        await tx.accountTransaction.create({
          data: {
            accountId: created.id,
            type: 'CREDIT',
            subType: 'OPENING_BALANCE',
            amount: dto.openingBalance,
            operationDate: new Date(),
            createdBy,
          },
        });
      }
      return created;
    });
    return this.findOne(businessId, account.id);
  }

  async findOne(businessId: number, id: number) {
    const a = await this.prisma.account.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { accountType: { select: { id: true, name: true } } },
    });
    if (!a) throw new NotFoundException('Account not found');
    const balances = await this.balancesFor([id]);
    return {
      id: a.id,
      name: a.name,
      accountNumber: a.accountNumber,
      accountTypeId: a.accountTypeId,
      accountType: a.accountType?.name ?? null,
      accountDetails: (a.accountDetails as { label: string; value: string }[] | null) ?? [],
      note: a.note,
      isClosed: a.isClosed,
      balance: balances.get(id) ?? 0,
    };
  }

  async update(businessId: number, id: number, dto: SaveAccountDto) {
    await this.requireAccount(businessId, id);
    if (dto.accountTypeId) await this.assertTypeInBusiness(businessId, dto.accountTypeId);
    // Mirrors GOURI: update() does NOT touch the opening-balance row.
    await this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        accountNumber: dto.accountNumber,
        accountTypeId: dto.accountTypeId ?? null,
        accountDetails: (dto.accountDetails ?? []) as Prisma.InputJsonValue,
        note: dto.note ?? null,
      },
    });
    return this.findOne(businessId, id);
  }

  async setClosed(businessId: number, id: number, isClosed: boolean) {
    await this.requireAccount(businessId, id);
    await this.prisma.account.update({ where: { id }, data: { isClosed } });
    return { success: true, msg: isClosed ? 'Account closed' : 'Account activated' };
  }

  async remove(businessId: number, id: number) {
    await this.requireAccount(businessId, id);
    await this.prisma.account.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true, msg: 'Account deleted successfully' };
  }

  private async assertTypeInBusiness(businessId: number, accountTypeId: number) {
    const t = await this.prisma.accountType.findFirst({ where: { id: accountTypeId, businessId } });
    if (!t) throw new BadRequestException('Invalid account type');
  }

  // ── Account Book (single account ledger, running balance) ───
  async accountBook(businessId: number, id: number) {
    const account = await this.findOne(businessId, id);
    const rows = await this.prisma.accountTransaction.findMany({
      where: { accountId: id, deletedAt: null },
      orderBy: [{ operationDate: 'asc' }, { id: 'asc' }],
      include: {
        transaction: { select: { refNo: true, type: true } },
        transactionPayment: { select: { paymentRefNo: true, method: true } },
      },
    });
    let running = 0;
    const ledger = rows.map((r) => {
      const amt = Number(r.amount);
      running += (r.type === 'CREDIT' ? 1 : -1) * amt;
      return {
        id: r.id,
        date: r.operationDate,
        type: r.type,
        subType: r.subType,
        amount: amt,
        debit: r.type === 'DEBIT' ? amt : 0,
        credit: r.type === 'CREDIT' ? amt : 0,
        balance: running,
        note: r.note,
        refNo: r.transaction?.refNo ?? r.transactionPayment?.paymentRefNo ?? null,
        method: r.transactionPayment?.method ?? null,
        transactionType: r.transaction?.type ?? null,
        editable: r.subType != null,
      };
    });
    return { account, ledger };
  }

  // ── Cash Flow (all accounts, one row per movement) ──────────
  async cashFlow(businessId: number, params: { accountId?: number; from?: string; to?: string }) {
    const where: Prisma.AccountTransactionWhereInput = {
      deletedAt: null,
      account: { businessId, deletedAt: null },
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.from || params.to
        ? {
            operationDate: {
              ...(params.from ? { gte: new Date(params.from) } : {}),
              ...(params.to ? { lte: new Date(`${params.to}T23:59:59`) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.accountTransaction.findMany({
      where,
      orderBy: [{ operationDate: 'asc' }, { id: 'asc' }],
      include: {
        account: { select: { name: true } },
        transaction: { select: { refNo: true, type: true } },
        transactionPayment: { select: { paymentRefNo: true, method: true } },
      },
    });
    let running = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const data = rows.map((r) => {
      const amt = Number(r.amount);
      running += (r.type === 'CREDIT' ? 1 : -1) * amt;
      if (r.type === 'DEBIT') totalDebit += amt;
      else totalCredit += amt;
      return {
        id: r.id,
        date: r.operationDate,
        account: r.account.name,
        type: r.type,
        subType: r.subType,
        debit: r.type === 'DEBIT' ? amt : 0,
        credit: r.type === 'CREDIT' ? amt : 0,
        balance: running,
        note: r.note,
        refNo: r.transaction?.refNo ?? r.transactionPayment?.paymentRefNo ?? null,
        paymentMethod: r.transactionPayment?.method ?? null,
      };
    });
    return { data, totals: { totalDebit, totalCredit, balance: running } };
  }

  // ── Fund Transfer (debit from + credit to) ──────────────────
  async fundTransfer(businessId: number, createdBy: number, dto: FundTransferDto) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Choose two different accounts');
    }
    await this.requireAccount(businessId, dto.fromAccountId);
    await this.requireAccount(businessId, dto.toAccountId);
    const opDate = dto.operationDate ?? new Date();

    await this.prisma.$transaction(async (tx) => {
      const debit = await tx.accountTransaction.create({
        data: {
          accountId: dto.fromAccountId,
          type: 'DEBIT',
          subType: 'FUND_TRANSFER',
          amount: dto.amount,
          operationDate: opDate,
          createdBy,
          note: dto.note ?? null,
        },
      });
      const credit = await tx.accountTransaction.create({
        data: {
          accountId: dto.toAccountId,
          type: 'CREDIT',
          subType: 'FUND_TRANSFER',
          amount: dto.amount,
          operationDate: opDate,
          createdBy,
          note: dto.note ?? null,
          transferTransactionId: debit.id,
        },
      });
      await tx.accountTransaction.update({
        where: { id: debit.id },
        data: { transferTransactionId: credit.id },
      });
    });
    return { success: true, msg: 'Fund transferred successfully' };
  }

  // ── Deposit (credit to + optional debit from) ───────────────
  async deposit(businessId: number, createdBy: number, dto: DepositDto) {
    await this.requireAccount(businessId, dto.toAccountId);
    if (dto.fromAccountId) {
      if (dto.fromAccountId === dto.toAccountId) throw new BadRequestException('Choose two different accounts');
      await this.requireAccount(businessId, dto.fromAccountId);
    }
    const opDate = dto.operationDate ?? new Date();

    await this.prisma.$transaction(async (tx) => {
      const credit = await tx.accountTransaction.create({
        data: {
          accountId: dto.toAccountId,
          type: 'CREDIT',
          subType: 'DEPOSIT',
          amount: dto.amount,
          operationDate: opDate,
          createdBy,
          note: dto.note ?? null,
        },
      });
      if (dto.fromAccountId) {
        const debit = await tx.accountTransaction.create({
          data: {
            accountId: dto.fromAccountId,
            type: 'DEBIT',
            subType: 'DEPOSIT',
            amount: dto.amount,
            operationDate: opDate,
            createdBy,
            note: dto.note ?? null,
            transferTransactionId: credit.id,
          },
        });
        await tx.accountTransaction.update({
          where: { id: credit.id },
          data: { transferTransactionId: debit.id },
        });
      }
    });
    return { success: true, msg: 'Deposit added successfully' };
  }

  // ── edit / delete a MANUAL account transaction ──────────────
  private async requireManualTxn(businessId: number, id: number) {
    const row = await this.prisma.accountTransaction.findFirst({
      where: { id, deletedAt: null, account: { businessId } },
    });
    if (!row) throw new NotFoundException('Account transaction not found');
    if (!row.subType || !MANUAL_SUB_TYPES.includes(row.subType)) {
      throw new ForbiddenException('Only manual account entries can be modified');
    }
    return row;
  }

  async updateAccountTransaction(businessId: number, id: number, dto: UpdateAccountTransactionDto) {
    const row = await this.requireManualTxn(businessId, id);
    const data = {
      amount: dto.amount,
      operationDate: dto.operationDate ?? row.operationDate,
      note: dto.note ?? null,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.accountTransaction.update({ where: { id }, data });
      // Mirror the paired transfer/deposit leg (amount/date/note), keeping both sides equal.
      if (row.transferTransactionId) {
        await tx.accountTransaction.update({ where: { id: row.transferTransactionId }, data });
      }
    });
    return { success: true, msg: 'Account transaction updated' };
  }

  async deleteAccountTransaction(businessId: number, id: number) {
    const row = await this.requireManualTxn(businessId, id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (row.transferTransactionId) {
        await tx.accountTransaction.update({ where: { id: row.transferTransactionId }, data: { deletedAt: now } });
      }
      await tx.accountTransaction.update({ where: { id }, data: { deletedAt: now } });
    });
    return { success: true, msg: 'Account transaction deleted' };
  }
}
