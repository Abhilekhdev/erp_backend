import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AbilityService } from '../../common/services/ability.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AccountPostingService } from '../accounts/account-posting.service';
import type { AccessPayload } from '../auth/token.service';
import type { ExpensesQueryDto, SaveExpenseDto, UpdateExpenseDto } from './dto/save-expense.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;
const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }) =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();

/** GOURI TransactionUtil::updatePaymentStatus — paid vs the grand total. */
function paymentStatusFor(total: number, paid: number): 'PAID' | 'PARTIAL' | 'DUE' {
  if (paid <= 0) return 'DUE';
  if (paid + 0.0001 >= total) return 'PAID';
  return 'PARTIAL';
}

/** Entered `final_total` is tax-INCLUSIVE (GOURI createExpense): base = final / (1 + tax%/100). */
function splitMoney(finalTotal: number, taxPercent: number) {
  const base = taxPercent > 0 ? finalTotal / (1 + taxPercent / 100) : finalTotal;
  return { lineSubtotal: round4(base), taxAmount: round4(finalTotal - base), finalTotal: round4(finalTotal) };
}

interface PaymentInput {
  amount: number;
  method: string;
  account_id?: number;
  paid_on?: string;
  card_transaction_number?: string;
  card_holder_name?: string;
  card_type?: string;
  cheque_number?: string;
  bank_account_number?: string;
  transaction_no?: string;
  note?: string;
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceNumberService,
    private readonly audit: AuditService,
    private readonly ability: AbilityService,
    private readonly accountPosting: AccountPostingService,
  ) {}

  /** Dropdown data for the expense form. */
  async meta(businessId: number) {
    const [categories, locations, users, taxRates, accounts] = await this.prisma.$transaction([
      this.prisma.expenseCategory.findMany({
        where: { businessId, deletedAt: null, parentId: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.businessLocation.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { businessId, userType: 'USER', deletedAt: null },
        select: { id: true, surname: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.taxRate.findMany({
        where: { businessId, deletedAt: null, forTaxGroup: false },
        select: { id: true, name: true, amount: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.account.findMany({
        where: { businessId, deletedAt: null, isClosed: false },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      categories,
      locations,
      accounts,
      taxRates: taxRates.map((t) => ({ id: t.id, name: t.name, amount: Number(t.amount) })),
      expenseForUsers: users.map((u) => ({ id: u.id, name: fullName(u) })),
    };
  }

  async findAll(user: AccessPayload, query: ExpensesQueryDto) {
    const businessId = user.businessId as number;
    const search = query.search.trim();
    // GOURI: users without `all_expense.access` only see their own expenses.
    const ownOnly = !(await this.ability.can(user, 'all_expense.access'));

    const where: Prisma.TransactionWhereInput = {
      businessId,
      type: { in: ['EXPENSE', 'EXPENSE_REFUND'] },
      ...(ownOnly ? { createdBy: user.sub } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.expenseCategoryId ? { expenseCategoryId: query.expenseCategoryId } : {}),
      ...(query.expenseSubCategoryId ? { expenseSubCategoryId: query.expenseSubCategoryId } : {}),
      ...(query.expenseFor ? { expenseFor: query.expenseFor } : {}),
      ...(query.paymentStatus
        ? { paymentStatus: query.paymentStatus.toUpperCase() as 'PAID' | 'PARTIAL' | 'DUE' }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? { transactionDate: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } }
        : {}),
      ...(search ? { OR: [{ refNo: { contains: search, mode: 'insensitive' } }] } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { transactionDate: 'desc' },
        select: {
          id: true,
          refNo: true,
          transactionDate: true,
          type: true,
          finalTotal: true,
          paymentStatus: true,
          expenseFor: true,
          expenseCategory: { select: { name: true } },
          expenseSubCategory: { select: { name: true } },
          location: { select: { name: true } },
          contact: { select: { name: true, supplierBusinessName: true } },
          payments: { select: { amount: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const forIds = [...new Set(rows.map((r) => r.expenseFor).filter((v): v is number => v != null))];
    const forUsers = forIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: forIds } },
          select: { id: true, surname: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(forUsers.map((u) => [u.id, fullName(u)]));

    const data = rows.map((r) => {
      const paid = r.payments.reduce((s, p) => s + Number(p.amount), 0);
      const grand = Number(r.finalTotal);
      return {
        id: r.id,
        refNo: r.refNo,
        date: r.transactionDate.toISOString().slice(0, 10),
        isRefund: r.type === 'EXPENSE_REFUND',
        category: r.expenseCategory?.name ?? '',
        subCategory: r.expenseSubCategory?.name ?? '',
        location: r.location?.name ?? '',
        contact: r.contact?.name ?? r.contact?.supplierBusinessName ?? '',
        expenseFor: r.expenseFor ? (nameById.get(r.expenseFor) ?? '') : '',
        paymentStatus: r.paymentStatus.toLowerCase(),
        finalTotal: grand,
        totalPaid: round4(paid),
        paymentDue: round4(grand - paid),
      };
    });
    return { data, total };
  }

  async findOne(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const e = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: { in: ['EXPENSE', 'EXPENSE_REFUND'] } },
      include: { payments: true },
    });
    if (!e) throw new NotFoundException('Expense not found');
    return {
      id: e.id,
      refNo: e.refNo,
      transactionDate: e.transactionDate.toISOString().slice(0, 10),
      locationId: e.locationId,
      isRefund: e.type === 'EXPENSE_REFUND',
      expenseCategoryId: e.expenseCategoryId,
      expenseSubCategoryId: e.expenseSubCategoryId,
      expenseFor: e.expenseFor,
      contactId: e.contactId,
      taxRateId: e.taxRateId,
      finalTotal: Number(e.finalTotal),
      taxAmount: Number(e.taxAmount),
      additionalNotes: e.additionalNotes ?? '',
      document: e.document ?? '',
      isRecurring: e.isRecurring,
      recurInterval: e.recurInterval != null ? Number(e.recurInterval) : null,
      recurIntervalType: e.recurIntervalType ? e.recurIntervalType.toLowerCase() : '',
      recurRepetitions: e.recurRepetitions,
      paymentStatus: e.paymentStatus.toLowerCase(),
      payments: e.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        accountId: p.accountId,
        paidOn: p.paidOn.toISOString().slice(0, 10),
        note: p.note ?? '',
      })),
    };
  }

  async create(user: AccessPayload, dto: SaveExpenseDto) {
    const businessId = user.businessId as number;
    await this.assertRefs(businessId, dto);

    const type = dto.is_refund ? 'EXPENSE_REFUND' : 'EXPENSE';
    const taxPercent = dto.tax_rate_id ? await this.taxPercent(businessId, dto.tax_rate_id) : 0;
    const money = splitMoney(dto.final_total, taxPercent);

    const refNo = blank(dto.ref_no) ?? (await this.refs.generate(businessId, 'expense', 'EP'));
    if (await this.prisma.transaction.findFirst({ where: { businessId, refNo }, select: { id: true } })) {
      throw new ConflictException(`Reference number "${refNo}" is already used`);
    }

    const id = await this.prisma.$transaction(
      async (tx) => {
        const expense = await tx.transaction.create({
          data: {
            businessId,
            locationId: dto.location_id,
            type,
            status: 'FINAL',
            contactId: dto.contact_id ?? null,
            refNo,
            transactionDate: new Date(dto.transaction_date),
            expenseCategoryId: dto.expense_category_id ?? null,
            expenseSubCategoryId: dto.expense_sub_category_id ?? null,
            expenseFor: dto.expense_for ?? null,
            taxRateId: dto.tax_rate_id ?? null,
            lineSubtotal: money.lineSubtotal,
            taxAmount: money.taxAmount,
            finalTotal: money.finalTotal,
            paymentStatus: 'DUE',
            additionalNotes: blank(dto.additional_notes),
            document: blank(dto.document),
            ...this.recurData(dto),
            createdBy: user.sub,
          },
        });
        await this.writePayments(tx, businessId, expense.id, user.sub, dto.contact_id ?? null, type, dto.payment ?? []);
        await this.syncPaymentStatus(tx, expense.id, money.finalTotal);
        return expense.id;
      },
      { timeout: 30000 },
    );

    this.audit.log({
      action: 'created',
      subjectType: 'Expense',
      subjectId: id,
      businessId,
      description: `Expense "${refNo}" created`,
      properties: { attributes: { refNo, finalTotal: money.finalTotal, type } },
    });
    return this.findOne(user, id);
  }

  async update(user: AccessPayload, id: number, dto: UpdateExpenseDto) {
    const businessId = user.businessId as number;
    const existing = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: { in: ['EXPENSE', 'EXPENSE_REFUND'] } },
    });
    if (!existing) throw new NotFoundException('Expense not found');
    await this.assertRefs(businessId, dto);

    const type: 'EXPENSE' | 'EXPENSE_REFUND' =
      dto.is_refund != null
        ? dto.is_refund
          ? 'EXPENSE_REFUND'
          : 'EXPENSE'
        : (existing.type as 'EXPENSE' | 'EXPENSE_REFUND');
    const finalTotal = dto.final_total != null ? dto.final_total : Number(existing.finalTotal);
    const taxRateId = dto.tax_rate_id !== undefined ? (dto.tax_rate_id ?? null) : existing.taxRateId;
    const taxPercent = taxRateId ? await this.taxPercent(businessId, taxRateId) : 0;
    const money = splitMoney(finalTotal, taxPercent);

    let refNo = existing.refNo;
    if (dto.ref_no !== undefined) {
      refNo = blank(dto.ref_no) ?? existing.refNo;
      if (refNo !== existing.refNo) {
        const clash = await this.prisma.transaction.findFirst({
          where: { businessId, refNo, id: { not: id } },
          select: { id: true },
        });
        if (clash) throw new ConflictException(`Reference number "${refNo}" is already used`);
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.transaction.update({
          where: { id },
          data: {
            type,
            refNo,
            ...(dto.location_id !== undefined ? { locationId: dto.location_id } : {}),
            ...(dto.transaction_date !== undefined ? { transactionDate: new Date(dto.transaction_date) } : {}),
            ...(dto.contact_id !== undefined ? { contactId: dto.contact_id ?? null } : {}),
            ...(dto.expense_category_id !== undefined ? { expenseCategoryId: dto.expense_category_id ?? null } : {}),
            ...(dto.expense_sub_category_id !== undefined ? { expenseSubCategoryId: dto.expense_sub_category_id ?? null } : {}),
            ...(dto.expense_for !== undefined ? { expenseFor: dto.expense_for ?? null } : {}),
            ...(dto.additional_notes !== undefined ? { additionalNotes: blank(dto.additional_notes) } : {}),
            ...(dto.document !== undefined ? { document: blank(dto.document) } : {}),
            taxRateId,
            lineSubtotal: money.lineSubtotal,
            taxAmount: money.taxAmount,
            finalTotal: money.finalTotal,
            ...this.recurData(dto),
          },
        });

        // A full-form edit replaces the payment set (mirrors GOURI's edit).
        if (dto.payment !== undefined) {
          await tx.accountTransaction.deleteMany({ where: { transactionId: id } });
          await tx.transactionPayment.deleteMany({ where: { transactionId: id } });
          await this.writePayments(tx, businessId, id, user.sub, dto.contact_id ?? existing.contactId, type, dto.payment);
        }
        await this.syncPaymentStatus(tx, id, money.finalTotal);
      },
      { timeout: 30000 },
    );

    this.audit.log({
      action: 'updated',
      subjectType: 'Expense',
      subjectId: id,
      businessId,
      description: `Expense "${refNo}" updated`,
    });
    return this.findOne(user, id);
  }

  async remove(user: AccessPayload, id: number) {
    const businessId = user.businessId as number;
    const expense = await this.prisma.transaction.findFirst({
      where: { id, businessId, type: { in: ['EXPENSE', 'EXPENSE_REFUND'] } },
      select: { id: true, refNo: true, finalTotal: true },
    });
    if (!expense) throw new NotFoundException('Expense not found');

    await this.prisma.$transaction(async (tx) => {
      // Account ledger rows have no cascade; clear them before the payments/transaction go.
      await tx.accountTransaction.deleteMany({ where: { transactionId: id } });
      await tx.transaction.delete({ where: { id } }); // payments cascade
    });

    this.audit.log({
      action: 'deleted',
      subjectType: 'Expense',
      subjectId: id,
      businessId,
      description: `Expense "${expense.refNo}" deleted`,
      properties: { attributes: { refNo: expense.refNo, finalTotal: Number(expense.finalTotal) } },
    });
    return { success: true };
  }

  // ── helpers ──────────────────────────────────────────
  private recurData(dto: SaveExpenseDto | UpdateExpenseDto) {
    if (dto.is_recurring == null && !('is_recurring' in dto)) return {};
    if (!dto.is_recurring) {
      return { isRecurring: false, recurInterval: null, recurIntervalType: null, recurRepetitions: null };
    }
    return {
      isRecurring: true,
      recurInterval: dto.recur_interval ?? 1,
      recurIntervalType: dto.recur_interval_type
        ? (dto.recur_interval_type.toUpperCase() as 'DAYS' | 'MONTHS' | 'YEARS')
        : null,
      recurRepetitions: dto.recur_repetitions ?? null,
    };
  }

  private async writePayments(
    tx: Prisma.TransactionClient,
    businessId: number,
    transactionId: number,
    userId: number,
    contactId: number | null,
    type: 'EXPENSE' | 'EXPENSE_REFUND',
    payments: PaymentInput[],
  ) {
    for (const p of payments) {
      const amount = Number(p.amount) || 0;
      if (amount <= 0) continue;
      const refNo = await this.refs.generate(businessId, 'expense_payment', 'EPP');
      const accountId = p.account_id ?? null;
      const paidOn = p.paid_on ? new Date(p.paid_on) : new Date();
      const payment = await tx.transactionPayment.create({
        data: {
          businessId,
          transactionId,
          amount,
          method: p.method,
          accountId,
          paymentRefNo: refNo,
          paidOn,
          paymentFor: contactId,
          cardTransactionNumber: blank(p.card_transaction_number),
          cardHolderName: blank(p.card_holder_name),
          cardType: blank(p.card_type),
          chequeNumber: blank(p.cheque_number),
          bankAccountNumber: blank(p.bank_account_number),
          transactionNo: blank(p.transaction_no),
          note: blank(p.note),
          createdBy: userId,
        },
      });
      await this.accountPosting.postForPayment(tx, {
        paymentId: payment.id,
        accountId,
        transactionId,
        transactionType: type === 'EXPENSE_REFUND' ? 'expense_refund' : 'expense',
        amount,
        paidOn,
        createdBy: userId,
      });
    }
  }

  private async syncPaymentStatus(tx: Prisma.TransactionClient, transactionId: number, finalTotal: number) {
    const paid = await tx.transactionPayment.aggregate({ where: { transactionId }, _sum: { amount: true } });
    const totalPaid = Number(paid._sum.amount ?? 0);
    await tx.transaction.update({
      where: { id: transactionId },
      data: { paymentStatus: paymentStatusFor(finalTotal, totalPaid) },
    });
  }

  private async taxPercent(businessId: number, taxRateId: number): Promise<number> {
    const tax = await this.prisma.taxRate.findFirst({ where: { id: taxRateId, businessId }, select: { amount: true } });
    if (!tax) throw new BadRequestException('Selected tax rate is invalid');
    return Number(tax.amount);
  }

  private async assertRefs(businessId: number, dto: SaveExpenseDto | UpdateExpenseDto) {
    if (dto.location_id) {
      const loc = await this.prisma.businessLocation.findFirst({
        where: { id: dto.location_id, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!loc) throw new BadRequestException('Selected location is invalid');
    }
    for (const key of ['expense_category_id', 'expense_sub_category_id'] as const) {
      const val = dto[key];
      if (val) {
        const cat = await this.prisma.expenseCategory.findFirst({
          where: { id: val, businessId, deletedAt: null },
          select: { id: true },
        });
        if (!cat) throw new BadRequestException('Selected expense category is invalid');
      }
    }
    if (dto.expense_for) {
      const u = await this.prisma.user.findFirst({
        where: { id: dto.expense_for, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!u) throw new BadRequestException('Selected "expense for" user is invalid');
    }
  }
}
