import { Injectable } from '@nestjs/common';
import { AccountTransactionType, Prisma } from '@prisma/client';

/**
 * Posts / reverses the `account_transactions` row that mirrors a payment — GOURI's
 * `AddAccountTransaction` / `UpdateAccountTransaction` / `DeleteAccountTransaction` listeners.
 *
 * A payment only touches an account when its `accountId` is set (prefilled from the location's
 * `default_payment_accounts`). The posted row has `sub_type = NULL` (auto), linked by
 * `transaction_payment_id`. Every method takes the caller's Prisma tx so it joins their transaction.
 */
@Injectable()
export class AccountPostingService {
  /** GOURI `AccountTransaction::getAccountTransactionType` — which side of the account a payment lands on. */
  private typeFor(transactionType: string, isReturn = false): AccountTransactionType {
    const map: Record<string, AccountTransactionType> = {
      purchase: 'DEBIT',
      sell: 'CREDIT',
      expense: 'DEBIT',
      purchase_return: 'CREDIT',
      sell_return: 'DEBIT',
      payroll: 'DEBIT',
      expense_refund: 'CREDIT',
    };
    let type = map[transactionType] ?? 'CREDIT';
    // A change/refund on a sell flips it (money leaves the drawer).
    if (transactionType === 'sell' && isReturn) type = 'DEBIT';
    return type;
  }

  /** Create the ledger row for a just-saved payment. No-op when no account was chosen. */
  async postForPayment(
    tx: Prisma.TransactionClient,
    input: {
      paymentId: number;
      accountId: number | null | undefined;
      transactionId: number | null;
      transactionType: string;
      amount: number;
      paidOn: Date;
      createdBy: number;
      isReturn?: boolean;
      note?: string | null;
    },
  ): Promise<void> {
    if (!input.accountId) return;
    await tx.accountTransaction.create({
      data: {
        accountId: input.accountId,
        type: this.typeFor(input.transactionType, input.isReturn),
        subType: null,
        amount: input.amount,
        operationDate: input.paidOn,
        createdBy: input.createdBy,
        transactionId: input.transactionId,
        transactionPaymentId: input.paymentId,
        note: input.note ?? null,
      },
    });
  }

  /** Remove the ledger row(s) for a payment being deleted (GOURI DeleteAccountTransaction). */
  async reverseForPayment(tx: Prisma.TransactionClient, paymentId: number): Promise<void> {
    await tx.accountTransaction.deleteMany({ where: { transactionPaymentId: paymentId } });
  }
}
