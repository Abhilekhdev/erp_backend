import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Balance Sheet, Trial Balance, Payment Account Report.
 *
 * Purchase-side figures are LIVE (Purchases is built). Sell-side figures (`getSellTotals`) and
 * closing-stock valuation are honest zeroes until the Sells module lands — each response carries a
 * `pending[]` note listing exactly what will fill in, mirroring how the Stock Report shipped.
 */
@Injectable()
export class AccountReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Σ purchases and what has been paid against them (GOURI getPurchaseTotals, purchase side). */
  private async purchaseTotals(businessId: number) {
    const [billed, paid] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { businessId, type: 'PURCHASE' },
        _sum: { finalTotal: true },
      }),
      this.prisma.transactionPayment.aggregate({
        where: { businessId, method: { not: 'advance' }, transaction: { type: 'PURCHASE' } },
        _sum: { amount: true },
      }),
    ]);
    const total = Number(billed._sum.finalTotal ?? 0);
    const totalPaid = Number(paid._sum.amount ?? 0);
    return { total, totalPaid, due: total - totalPaid };
  }

  /** Debit / credit totals per account, from account_transactions. */
  private async accountLedger(businessId: number) {
    const accounts = await this.prisma.account.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true, accountNumber: true },
      orderBy: { name: 'asc' },
    });
    const groups = await this.prisma.accountTransaction.groupBy({
      by: ['accountId', 'type'],
      where: { deletedAt: null, account: { businessId } },
      _sum: { amount: true },
    });
    return accounts.map((a) => {
      const debit = Number(groups.find((g) => g.accountId === a.id && g.type === 'DEBIT')?._sum.amount ?? 0);
      const credit = Number(groups.find((g) => g.accountId === a.id && g.type === 'CREDIT')?._sum.amount ?? 0);
      return { id: a.id, name: a.name, accountNumber: a.accountNumber, debit, credit, balance: credit - debit };
    });
  }

  async trialBalance(businessId: number) {
    const [purchase, accounts] = await Promise.all([
      this.purchaseTotals(businessId),
      this.accountLedger(businessId),
    ]);
    return {
      accounts,
      summary: {
        purchase: purchase.total,
        purchasePaid: purchase.totalPaid,
        purchaseDue: purchase.due,
        sell: 0,
        sellPaid: 0,
        sellDue: 0,
      },
      pending: ['sell totals — needs the Sells module', 'expenses — needs the Expenses module'],
    };
  }

  async balanceSheet(businessId: number) {
    const [purchase, accounts] = await Promise.all([
      this.purchaseTotals(businessId),
      this.accountLedger(businessId),
    ]);
    const accountBalancesTotal = accounts.reduce((a, x) => a + x.balance, 0);
    return {
      assets: {
        paymentAccounts: accountBalancesTotal,
        closingStock: 0, // pending: stock valuation
        customerDue: 0, // pending: Sells
        accounts,
      },
      liabilities: {
        supplierDue: purchase.due,
      },
      pending: [
        'closing stock valuation — needs stock-value roll-up',
        'customer receivables & sell income — needs the Sells module',
      ],
    };
  }

  async paymentAccountReport(
    businessId: number,
    params: { accountId?: number; from?: string; to?: string; method?: string },
  ) {
    const where: Prisma.TransactionPaymentWhereInput = {
      businessId,
      parentId: null,
      method: params.method ? params.method : { not: 'advance' },
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.from || params.to
        ? {
            paidOn: {
              ...(params.from ? { gte: new Date(params.from) } : {}),
              ...(params.to ? { lte: new Date(`${params.to}T23:59:59`) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.transactionPayment.findMany({
      where,
      orderBy: [{ paidOn: 'desc' }, { id: 'desc' }],
      take: 1000,
      include: {
        transaction: { select: { refNo: true, type: true } },
        account: { select: { name: true } },
      },
    });

    let totalIn = 0;
    let totalOut = 0;
    const data = rows.map((p) => {
      const amt = Number(p.amount);
      // On our current (purchase) side, a payment is money OUT unless it's a refund.
      if (p.isReturn) totalIn += amt;
      else totalOut += amt;
      return {
        id: p.id,
        date: p.paidOn,
        paymentRefNo: p.paymentRefNo,
        transactionRefNo: p.transaction?.refNo ?? null,
        transactionType: p.transaction?.type ?? null,
        method: p.method,
        amount: amt,
        isReturn: p.isReturn,
        account: p.account?.name ?? null,
      };
    });
    return { data, totals: { totalIn, totalOut, count: data.length } };
  }
}
