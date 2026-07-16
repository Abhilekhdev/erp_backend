import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AbilityService } from '../../common/services/ability.service';
import { MailService } from '../../common/services/mail.service';
import { ReferenceNumberService } from '../../common/services/reference-number.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PayslipPdfService } from './payslip-pdf.service';
import type { AccessPayload } from '../auth/token.service';
import type { AddPayrollPaymentsDto } from './dto/payroll-payment.dto';
import type { GeneratePayrollDto, PayrollQueryDto, PreparePayrollDto } from './dto/payroll.dto';
import type { UpdatePayrollGroupDto } from './dto/payroll.dto';

const VIEW_ALL = 'essentials.view_all_payroll';

const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * `users.bank_details` is JSON stored in a TEXT column, so Prisma hands back a raw string.
 * It must be PARSED — a bare `as Record<...>` cast is a compile-time lie that leaks the string
 * to the client, where `Object.entries()` then walks it character by character.
 */
const parseBankDetails = (v: unknown): Record<string, unknown> | null => {
  if (!v) return null;
  if (typeof v === 'object') return Array.isArray(v) ? null : (v as Record<string, unknown>);
  if (typeof v !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null; // legacy/garbage value — show nothing rather than a mangled string
  }
};
// Parse "YYYY-MM" as UTC midnight. Without the trailing Z this is parsed in server-local time, so
// any timezone east of UTC rolls back to the previous month's last day (IST: 2026-06 -> 2026-05-31),
// storing every payroll one month early. `monthLabel` reads back in UTC, so both must be UTC.
const monthDate = (m: string): Date => new Date(`${m}-01T00:00:00Z`);
const monthLabel = (d: Date): string =>
  d.toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ability: AbilityService,
    private readonly refNo: ReferenceNumberService,
    private readonly pdf: PayslipPdfService,
    private readonly mail: MailService,
  ) {}

  async meta(businessId: number) {
    const [employees, locations, departments, designations] = await Promise.all([
      this.prisma.user.findMany({
        where: { businessId, userType: 'USER', deletedAt: null, isCmmsnAgnt: false },
        select: { id: true, surname: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.businessLocation.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.findMany({
        where: { businessId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.designation.findMany({
        where: { businessId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      employees: employees.map((u) => ({ id: u.id, name: fullName(u) })),
      locations,
      departments,
      designations,
    };
  }

  /** Build the pre-filled generate form: basic salary + assigned pay components per employee. */
  async prepare(businessId: number, dto: PreparePayrollDto) {
    const month = monthDate(dto.month);
    const [existing, users] = await Promise.all([
      this.prisma.payroll.findMany({
        where: { businessId, month, userId: { in: dto.employeeIds } },
        select: { userId: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: dto.employeeIds }, businessId, deletedAt: null },
        include: { allowanceDeductions: { include: { allowanceDeduction: true } } },
      }),
    ]);
    const existingSet = new Set(existing.map((e) => e.userId));
    return {
      skipped: users.filter((u) => existingSet.has(u.id)).map((u) => fullName(u)),
      employees: users
        .filter((u) => !existingSet.has(u.id))
        .map((u) => ({
          userId: u.id,
          name: fullName(u),
          basicSalary: u.essentialsSalary ? Number(u.essentialsSalary) : 0,
          lines: u.allowanceDeductions.map((ad) => ({
            type: ad.allowanceDeduction.type.toLowerCase(),
            description: ad.allowanceDeduction.description,
            amountType: ad.allowanceDeduction.amountType.toLowerCase(),
            amount: Number(ad.allowanceDeduction.amount),
          })),
        })),
    };
  }

  async generate(businessId: number, createdBy: number, dto: GeneratePayrollDto) {
    const month = monthDate(dto.month);
    const existing = await this.prisma.payroll.findMany({
      where: { businessId, month, userId: { in: dto.employees.map((e) => e.userId) } },
      select: { userId: true },
    });
    const existingSet = new Set(existing.map((e) => e.userId));
    const toCreate = dto.employees.filter((e) => !existingSet.has(e.userId));
    if (!toCreate.length) {
      throw new BadRequestException('All selected employees already have a payroll for this month');
    }

    const groupId = await this.prisma.$transaction(async (tx) => {
      const group = await tx.payrollGroup.create({
        data: {
          businessId,
          name: dto.name,
          status: dto.status === 'final' ? 'FINAL' : 'DRAFT',
          paymentStatus: 'DUE',
          month,
          locationId: dto.locationId ?? null,
          createdBy,
          grossTotal: 0,
        },
      });
      let groupGross = 0;
      for (const emp of toCreate) {
        const basic = emp.basicSalary;
        let allow = 0;
        let deduct = 0;
        const lines = emp.lines
          .filter((l) => l.description.trim())
          .map((l) => {
            const computed = round(l.amountType === 'percent' ? (l.amount / 100) * basic : l.amount);
            if (l.type === 'allowance') allow += computed;
            else deduct += computed;
            return {
              type: (l.type === 'deduction' ? 'DEDUCTION' : 'ALLOWANCE') as 'ALLOWANCE' | 'DEDUCTION',
              description: l.description,
              amountType: (l.amountType === 'percent' ? 'PERCENT' : 'FIXED') as 'FIXED' | 'PERCENT',
              amount: l.amount,
              computed,
            };
          });
        const finalTotal = round(basic + allow - deduct);
        groupGross += finalTotal;
        const p = await tx.payroll.create({
          data: {
            businessId,
            payrollGroupId: group.id,
            userId: emp.userId,
            month,
            basicSalary: basic,
            finalTotal,
            status: dto.status === 'final' ? 'final' : 'draft',
            paymentStatus: 'DUE',
            createdBy,
          },
        });
        await tx.payroll.update({
          where: { id: p.id },
          data: { refNo: `PR${p.id.toString().padStart(4, '0')}` },
        });
        if (lines.length) {
          await tx.payrollLine.createMany({ data: lines.map((l) => ({ ...l, payrollId: p.id })) });
        }
      }
      await tx.payrollGroup.update({ where: { id: group.id }, data: { grossTotal: round(groupGross) } });
      return group.id;
    });
    return this.getGroup(businessId, groupId);
  }

  async listPayrolls(businessId: number, query: PayrollQueryDto, user: AccessPayload) {
    const s = query.search.trim();
    // Without view_all_payroll a user only sees their OWN payslips (GOURI: where expense_for = self).
    const canAll = await this.ability.can(user, VIEW_ALL);
    const where: Prisma.PayrollWhereInput = {
      businessId,
      ...(canAll ? {} : { userId: user.sub }),
      ...(query.employeeId && canAll ? { userId: query.employeeId } : {}),
      ...(query.month ? { month: monthDate(query.month) } : {}),
      ...(query.departmentId ? { user: { essentialsDepartmentId: query.departmentId } } : {}),
      ...(query.designationId ? { user: { essentialsDesignationId: query.designationId } } : {}),
      ...(query.locationId ? { group: { locationId: query.locationId } } : {}),
      ...(s ? { refNo: { contains: s, mode: 'insensitive' } } : {}),
    };
    const [rows, total, depts, desigs] = await Promise.all([
      this.prisma.payroll.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { month: 'desc' },
        include: { user: true },
      }),
      this.prisma.payroll.count({ where }),
      this.prisma.department.findMany({ where: { businessId }, select: { id: true, name: true } }),
      this.prisma.designation.findMany({ where: { businessId }, select: { id: true, name: true } }),
    ]);
    const deptMap = new Map(depts.map((d) => [d.id, d.name]));
    const desigMap = new Map(desigs.map((d) => [d.id, d.name]));
    return {
      data: rows.map((p) => ({
        id: p.id,
        employee: fullName(p.user),
        department: p.user.essentialsDepartmentId ? deptMap.get(p.user.essentialsDepartmentId) ?? '' : '',
        designation: p.user.essentialsDesignationId ? desigMap.get(p.user.essentialsDesignationId) ?? '' : '',
        month: monthLabel(p.month),
        refNo: p.refNo,
        total: Number(p.finalTotal),
        paymentStatus: p.paymentStatus.toLowerCase(),
        groupId: p.payrollGroupId,
      })),
      total,
    };
  }

  async listGroups(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const s = query.search.trim();
    const where: Prisma.PayrollGroupWhereInput = {
      businessId,
      ...(s ? { name: { contains: s, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payrollGroup.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { payrolls: true } } },
      }),
      this.prisma.payrollGroup.count({ where }),
    ]);
    return {
      data: rows.map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status.toLowerCase(),
        paymentStatus: g.paymentStatus.toLowerCase(),
        grossTotal: Number(g.grossTotal),
        month: monthLabel(g.month),
        employees: g._count.payrolls,
      })),
      total,
    };
  }

  async getGroup(businessId: number, id: number) {
    const g = await this.prisma.payrollGroup.findFirst({
      where: { id, businessId },
      include: { payrolls: { include: { user: true, lines: true } } },
    });
    if (!g) throw new NotFoundException('Payroll group not found');
    return {
      id: g.id,
      name: g.name,
      status: g.status.toLowerCase(),
      paymentStatus: g.paymentStatus.toLowerCase(),
      grossTotal: Number(g.grossTotal),
      month: monthLabel(g.month),
      payrolls: g.payrolls.map((p) => this.shapePayroll(p)),
    };
  }

  async getPayroll(businessId: number, id: number, user: AccessPayload) {
    const p = await this.prisma.payroll.findFirst({
      where: { id, businessId },
      include: { user: true, lines: true },
    });
    if (!p) throw new NotFoundException('Payroll not found');
    // A user without view_all_payroll may only open their own payslip.
    if (p.userId !== user.sub && !(await this.ability.can(user, VIEW_ALL))) {
      throw new NotFoundException('Payroll not found');
    }
    return this.shapePayroll(p);
  }

  private shapePayroll(
    p: Prisma.PayrollGetPayload<{ include: { user: true; lines: true } }>,
  ) {
    return {
      id: p.id,
      refNo: p.refNo,
      employee: fullName(p.user),
      month: monthLabel(p.month),
      basicSalary: Number(p.basicSalary),
      finalTotal: Number(p.finalTotal),
      paymentStatus: p.paymentStatus.toLowerCase(),
      allowances: p.lines
        .filter((l) => l.type === 'ALLOWANCE')
        .map((l) => ({ description: l.description, amount: Number(l.computed) })),
      deductions: p.lines
        .filter((l) => l.type === 'DEDUCTION')
        .map((l) => ({ description: l.description, amount: Number(l.computed) })),
    };
  }

  async deleteGroup(businessId: number, id: number) {
    const g = await this.prisma.payrollGroup.findFirst({ where: { id, businessId } });
    if (!g) throw new NotFoundException('Payroll group not found');
    if (g.status === 'FINAL' && g.paymentStatus === 'PAID') {
      throw new BadRequestException('A fully paid payroll group cannot be deleted');
    }
    await this.prisma.$transaction([
      this.prisma.payroll.deleteMany({ where: { payrollGroupId: id } }),
      this.prisma.payrollGroup.delete({ where: { id } }),
    ]);
    return { success: true };
  }

  /**
   * Mark a whole group paid without recording payment rows.
   * @deprecated Superseded by the real payment flow (`getGroupPaymentForm` + `addPayments`), which
   * mirrors GOURI's Add-Payment screen. Kept so older clients don't break; status set here is
   * recomputed from `payroll_payments` the next time a payment is recorded.
   */
  async payGroup(businessId: number, id: number) {
    const g = await this.prisma.payrollGroup.findFirst({ where: { id, businessId } });
    if (!g) throw new NotFoundException('Payroll group not found');
    await this.prisma.$transaction([
      this.prisma.payroll.updateMany({ where: { payrollGroupId: id }, data: { paymentStatus: 'PAID' } }),
      this.prisma.payrollGroup.update({ where: { id }, data: { paymentStatus: 'PAID' } }),
    ]);
    return this.getGroup(businessId, id);
  }

  // ===================== PAYMENTS (GOURI addPayment / postAddPayment) =====================

  /**
   * GET /hrm/payroll/groups/:id/payment-form — one row per employee in the group with the amount
   * still due, their bank details and prior payment refs. Mirrors PayrollController@addPayment.
   */
  async getGroupPaymentForm(businessId: number, id: number) {
    const g = await this.prisma.payrollGroup.findFirst({
      where: { id, businessId },
      include: { payrolls: { include: { user: true, payments: true } } },
    });
    if (!g) throw new NotFoundException('Payroll group not found');

    return {
      id: g.id,
      name: g.name,
      month: monthLabel(g.month),
      paymentStatus: g.paymentStatus.toLowerCase(),
      payrolls: g.payrolls.map((p) => {
        const paid = p.payments.reduce((s, x) => s + Number(x.amount), 0);
        return {
          payrollId: p.id,
          refNo: p.refNo,
          employee: fullName(p.user),
          finalTotal: Number(p.finalTotal),
          paid: round(paid),
          due: round(Number(p.finalTotal) - paid),
          paymentStatus: p.paymentStatus.toLowerCase(),
          paymentRefNos: p.payments.map((x) => x.paymentRefNo).filter(Boolean),
          bankDetails: parseBankDetails(p.user.bankDetails),
        };
      }),
    };
  }

  /**
   * POST /hrm/payroll/payments — record one payment per submitted row, then recompute each
   * payroll's status and the parent group's. Mirrors postAddPayment + _updatePayrollGroupPaymentStatus.
   * GOURI skips rows that are already fully paid or have no amount/method — so do we.
   */
  async addPayments(businessId: number, createdBy: number, dto: AddPayrollPaymentsDto) {
    const ids = dto.payments.map((p) => p.payroll_id);
    const payrolls = await this.prisma.payroll.findMany({
      where: { id: { in: ids }, businessId },
      include: { payments: true, user: true },
    });
    if (payrolls.length !== new Set(ids).size) {
      throw new NotFoundException('One or more payrolls were not found');
    }

    const touchedGroups = new Set<number>();
    let recorded = 0;

    for (const row of dto.payments) {
      const payroll = payrolls.find((p) => p.id === row.payroll_id)!;
      const alreadyPaid = payroll.payments.reduce((s, x) => s + Number(x.amount), 0);
      const due = round(Number(payroll.finalTotal) - alreadyPaid);
      if (due <= 0) continue; // already settled — GOURI skips these rows

      if (row.amount > due) {
        throw new BadRequestException(
          `Payment for ${fullName(payroll.user)} exceeds the amount due (${due})`,
        );
      }

      // GOURI numbers payroll payments off the shared `purchase_payment` counter.
      const paymentRefNo = await this.refNo.generate(businessId, 'purchase_payment');

      await this.prisma.payrollPayment.create({
        data: {
          businessId,
          payrollId: row.payroll_id,
          amount: row.amount,
          method: row.method,
          paidOn: row.paid_on,
          accountId: row.account_id ?? null,
          transactionNo: row.transaction_no ?? null,
          cardNumber: row.card_number ?? null,
          cardHolderName: row.card_holder_name ?? null,
          cardTransactionNumber: row.card_transaction_number ?? null,
          cardType: row.card_type ?? null,
          cardMonth: row.card_month ?? null,
          cardYear: row.card_year ?? null,
          cardSecurity: row.card_security ?? null,
          chequeNumber: row.cheque_number ?? null,
          bankAccountNumber: row.bank_account_number ?? null,
          note: row.note ?? null,
          paymentRefNo,
          createdBy,
        },
      });
      recorded++;
      await this.recomputePayrollStatus(row.payroll_id);
      if (payroll.payrollGroupId) touchedGroups.add(payroll.payrollGroupId);
    }

    for (const gid of touchedGroups) await this.recomputeGroupStatus(businessId, gid);
    return { success: true, recorded, msg: 'Payment added successfully' };
  }

  /** GET /hrm/payroll/:id/payments — the payment history of a payslip. */
  async listPayments(businessId: number, payrollId: number, user: AccessPayload) {
    await this.getPayroll(businessId, payrollId, user); // 404 + own-payslip scoping
    const rows = await this.prisma.payrollPayment.findMany({
      where: { businessId, payrollId },
      orderBy: { paidOn: 'asc' },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        paymentRefNo: r.paymentRefNo,
        amount: Number(r.amount),
        method: r.method,
        paidOn: r.paidOn,
        note: r.note,
        chequeNumber: r.chequeNumber,
        bankAccountNumber: r.bankAccountNumber,
        transactionNo: r.transactionNo,
      })),
    };
  }

  /** DELETE /hrm/payroll/payments/:id — remove a payment and re-derive the statuses. */
  async deletePayment(businessId: number, id: number) {
    const p = await this.prisma.payrollPayment.findFirst({
      where: { id, businessId },
      include: { payroll: { select: { payrollGroupId: true } } },
    });
    if (!p) throw new NotFoundException('Payment not found');
    await this.prisma.payrollPayment.delete({ where: { id } });
    await this.recomputePayrollStatus(p.payrollId);
    if (p.payroll.payrollGroupId) await this.recomputeGroupStatus(businessId, p.payroll.payrollGroupId);
    return { success: true };
  }

  /** Σ payments vs final_total → PAID / PARTIAL / DUE. */
  private async recomputePayrollStatus(payrollId: number): Promise<void> {
    const p = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      include: { payments: true },
    });
    if (!p) return;
    const paid = p.payments.reduce((s, x) => s + Number(x.amount), 0);
    const total = Number(p.finalTotal);
    const status = paid >= total && total > 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'DUE';
    await this.prisma.payroll.update({ where: { id: payrollId }, data: { paymentStatus: status } });
  }

  /** GOURI `_updatePayrollGroupPaymentStatus`: all paid → paid, all due → due, else partial. */
  private async recomputeGroupStatus(businessId: number, groupId: number): Promise<void> {
    const g = await this.prisma.payrollGroup.findFirst({
      where: { id: groupId, businessId },
      include: { payrolls: { select: { paymentStatus: true } } },
    });
    if (!g) return;
    const total = g.payrolls.length;
    const paid = g.payrolls.filter((p) => p.paymentStatus === 'PAID').length;
    const due = g.payrolls.filter((p) => p.paymentStatus !== 'PAID').length;
    const status = total === paid && total > 0 ? 'PAID' : total === due ? 'DUE' : 'PARTIAL';
    await this.prisma.payrollGroup.update({ where: { id: groupId }, data: { paymentStatus: status } });
  }

  // ===================== GROUP EDIT / PAYROLL DELETE =====================

  /** PATCH /hrm/payroll/groups/:id — edit group name/status (GOURI getEditPayrollGroup + update). */
  async updateGroup(businessId: number, id: number, dto: UpdatePayrollGroupDto) {
    const g = await this.prisma.payrollGroup.findFirst({ where: { id, businessId } });
    if (!g) throw new NotFoundException('Payroll group not found');
    await this.prisma.payrollGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.status !== undefined ? { status: dto.status === 'final' ? 'FINAL' : 'DRAFT' } : {}),
      },
    });
    return this.getGroup(businessId, id);
  }

  /** DELETE /hrm/payroll/:id — remove a single payslip (blocked once anything is paid). */
  async deletePayroll(businessId: number, id: number) {
    const p = await this.prisma.payroll.findFirst({
      where: { id, businessId },
      include: { payments: true },
    });
    if (!p) throw new NotFoundException('Payroll not found');
    if (p.payments.length > 0) {
      throw new BadRequestException('This payroll has payments recorded and cannot be deleted');
    }
    const groupId = p.payrollGroupId;
    await this.prisma.payroll.delete({ where: { id } });
    if (groupId) {
      await this.recomputeGroupStatus(businessId, groupId);
      // Keep the group's gross in step with the payslips that remain.
      const rest = await this.prisma.payroll.findMany({
        where: { payrollGroupId: groupId },
        select: { finalTotal: true },
      });
      await this.prisma.payrollGroup.update({
        where: { id: groupId },
        data: { grossTotal: round(rest.reduce((s, r) => s + Number(r.finalTotal), 0)) },
      });
    }
    return { success: true };
  }

  // ===================== PAYSLIP (GOURI generatePayslip) =====================

  /**
   * GET /hrm/payroll/:id/payslip — everything the GOURI payslip blade renders:
   * employee + department/designation/location, month, allowance/deduction lines, bank details,
   * leave & attendance figures for the month, YTD payroll, payments and amount due.
   *
   * PDF: GOURI renders this server-side with mpdf. We have no PDF engine in this stack, so the
   * endpoint returns data and the frontend renders a print-optimised payslip (browser → Save as PDF).
   */
  async getPayslip(businessId: number, id: number, user: AccessPayload) {
    const p = await this.prisma.payroll.findFirst({
      where: { id, businessId },
      include: { user: true, lines: true, payments: true, group: true },
    });
    if (!p) throw new NotFoundException('Payroll not found');
    if (p.userId !== user.sub && !(await this.ability.can(user, VIEW_ALL))) {
      throw new NotFoundException('Payroll not found');
    }

    const start = new Date(Date.UTC(p.month.getUTCFullYear(), p.month.getUTCMonth(), 1));
    const end = new Date(Date.UTC(p.month.getUTCFullYear(), p.month.getUTCMonth() + 1, 0));
    const daysInMonth = end.getUTCDate();

    const [business, department, designation, location] = await Promise.all([
      this.prisma.business.findUnique({
        where: { id: businessId },
        select: { name: true, fyStartMonth: true, currency: { select: { symbol: true } } },
      }),
      p.user.essentialsDepartmentId
        ? this.prisma.department.findFirst({
            where: { id: p.user.essentialsDepartmentId, businessId },
            select: { name: true },
          })
        : null,
      p.user.essentialsDesignationId
        ? this.prisma.designation.findFirst({
            where: { id: p.user.essentialsDesignationId, businessId },
            select: { name: true },
          })
        : null,
      p.user.locationId
        ? this.prisma.businessLocation.findFirst({
            where: { id: p.user.locationId, businessId },
            select: { name: true },
          })
        : null,
    ]);

    const [totalLeaves, daysPresent, workHours, ytd] = await Promise.all([
      this.leaveDaysInRange(businessId, p.userId, start, end),
      this.daysWorked(businessId, p.userId, start, end),
      this.workHours(businessId, p.userId, start, end),
      this.ytdPayroll(businessId, p.userId, p.month, business?.fyStartMonth ?? 1),
    ]);

    const paid = p.payments.reduce((s, x) => s + Number(x.amount), 0);

    return {
      id: p.id,
      refNo: p.refNo,
      month: monthLabel(p.month),
      monthName: p.month.toLocaleString('en', { month: 'long', timeZone: 'UTC' }),
      year: p.month.getUTCFullYear(),
      business: { name: business?.name ?? '', currencySymbol: business?.currency?.symbol ?? '' },
      employee: {
        id: p.user.id,
        name: fullName(p.user),
        email: p.user.email,
        department: department?.name ?? null,
        designation: designation?.name ?? null,
        location: location?.name ?? null,
        bankDetails: parseBankDetails(p.user.bankDetails),
      },
      groupName: p.group?.name ?? null,
      basicSalary: Number(p.basicSalary),
      allowances: p.lines
        .filter((l) => l.type === 'ALLOWANCE')
        .map((l) => ({ description: l.description, amount: Number(l.computed) })),
      deductions: p.lines
        .filter((l) => l.type === 'DEDUCTION')
        .map((l) => ({ description: l.description, amount: Number(l.computed) })),
      finalTotal: Number(p.finalTotal),
      paymentStatus: p.paymentStatus.toLowerCase(),
      totalPaid: round(paid),
      totalDue: round(Number(p.finalTotal) - paid),
      payments: p.payments.map((x) => ({
        id: x.id,
        paymentRefNo: x.paymentRefNo,
        amount: Number(x.amount),
        method: x.method,
        paidOn: x.paidOn,
      })),
      attendance: { daysInMonth, totalLeaves, daysPresent, workHours },
      ytdPayroll: ytd,
    };
  }

  /**
   * GET /hrm/payroll/:id/payslip/pdf — render the payslip server-side (GOURI generatePayslip /
   * downloadPayslip, which use mpdf). Returns the buffer + filename for the controller to stream.
   */
  async getPayslipPdf(businessId: number, id: number, user: AccessPayload) {
    const slip = await this.getPayslip(businessId, id, user);
    const buffer = await this.pdf.render(slip);
    return { buffer, filename: this.pdf.filename(slip.refNo) };
  }

  /**
   * POST /hrm/payroll/:id/send-email — email the payslip to the employee with the PDF attached.
   * Mirrors GOURI sendPayrollEmail (PayrollNotification + 'Payroll-<ref>.pdf' attachment).
   */
  async sendPayslipEmail(businessId: number, id: number, user: AccessPayload) {
    const slip = await this.getPayslip(businessId, id, user);
    if (!slip.employee.email) {
      throw new BadRequestException('This employee has no email address');
    }
    if (!this.mail.isConfigured()) {
      throw new BadRequestException(
        'Email is not configured — set MAIL_HOST / MAIL_USERNAME / MAIL_PASSWORD in the backend .env',
      );
    }

    const buffer = await this.pdf.render(slip);
    const cur = slip.business.currencySymbol;
    const amount = `${cur} ${slip.finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    await this.mail.send({
      to: slip.employee.email,
      subject: `Payslip for ${slip.monthName} ${slip.year} - ${slip.business.name}`,
      html: `
        <p>Dear ${slip.employee.name},</p>
        <p>Please find attached your payslip for <strong>${slip.monthName} ${slip.year}</strong>.</p>
        <p>Net payable: <strong>${amount}</strong><br/>Reference: ${slip.refNo ?? '-'}</p>
        <p>Regards,<br/>${slip.business.name}</p>
      `,
      text: `Dear ${slip.employee.name}, your payslip for ${slip.monthName} ${slip.year} is attached. Net payable: ${amount}.`,
      attachments: [
        { filename: this.pdf.filename(slip.refNo), content: buffer, contentType: 'application/pdf' },
      ],
    });

    return { success: true, msg: `Payslip emailed to ${slip.employee.email}` };
  }

  /** Total leave days inside the month (GOURI: diffInDays + 1 per leave, inclusive). */
  private async leaveDaysInRange(businessId: number, userId: number, start: Date, end: Date) {
    const leaves = await this.prisma.leave.findMany({
      where: { businessId, userId, startDate: { gte: start }, endDate: { lte: end } },
      select: { startDate: true, endDate: true },
    });
    return leaves.reduce(
      (sum, l) =>
        sum + Math.floor((l.endDate.getTime() - l.startDate.getTime()) / 86_400_000) + 1,
      0,
    );
  }

  /**
   * Days worked in the range — GOURI `getTotalDaysWorkedForGivenDateOfAnEmployee`: a day counts
   * when the employee has a COMPLETED attendance (clock-out present) OR the day is a leave /
   * location holiday / their shift's weekly off.
   *
   * NOTE: GOURI additionally subtracts a `sandwiched` counter that it never adds to the tally —
   * it only ever lowers the result for days that were never counted. That is a bug, so it is not
   * reproduced here (consistent with the other GOURI fixes in this port).
   */
  private async daysWorked(businessId: number, userId: number, start: Date, end: Date) {
    const [attendances, leaves, holidays, userShifts] = await Promise.all([
      this.prisma.attendance.findMany({
        where: {
          businessId,
          userId,
          clockOutTime: { not: null },
          clockInTime: { gte: start, lte: new Date(end.getTime() + 86_399_000) },
        },
        select: { clockInTime: true },
      }),
      this.prisma.leave.findMany({
        where: { businessId, userId, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } },
        select: { startDate: true, endDate: true },
      }),
      this.prisma.user
        .findUnique({ where: { id: userId }, select: { locationId: true } })
        .then((u) =>
          this.prisma.holiday.findMany({
            where: {
              businessId,
              deletedAt: null,
              startDate: { lte: end },
              endDate: { gte: start },
              ...(u?.locationId ? { OR: [{ locationId: null }, { locationId: u.locationId }] } : {}),
            },
            select: { startDate: true, endDate: true },
          }),
        ),
      this.prisma.userShift.findMany({
        where: { businessId, userId },
        select: { shift: { select: { holidays: true } } },
      }),
    ]);

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const present = new Set(attendances.map((a) => key(a.clockInTime!)));

    const off = new Set<string>();
    const addRange = (s: Date, e: Date) => {
      for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) off.add(key(d));
    };
    leaves.forEach((l) => addRange(l.startDate, l.endDate));
    holidays.forEach((h) => addRange(h.startDate, h.endDate));

    // Weekly offs configured on the employee's shift(s), e.g. ["saturday","sunday"].
    const weekdayOffs = new Set<string>();
    userShifts.forEach((us) => {
      const list = (us.shift?.holidays ?? []) as unknown;
      if (Array.isArray(list)) list.forEach((w) => weekdayOffs.add(String(w).toLowerCase()));
    });

    let worked = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = key(d);
      const weekday = d.toLocaleString('en', { weekday: 'long', timeZone: 'UTC' }).toLowerCase();
      if (present.has(k) || off.has(k) || weekdayOffs.has(weekday)) worked++;
    }
    return worked;
  }

  /** Total clocked hours in the range (GOURI getTotalWorkDuration('hour', ...)). */
  private async workHours(businessId: number, userId: number, start: Date, end: Date) {
    const rows = await this.prisma.attendance.findMany({
      where: {
        businessId,
        userId,
        clockOutTime: { not: null },
        clockInTime: { gte: start, lte: new Date(end.getTime() + 86_399_000) },
      },
      select: { clockInTime: true, clockOutTime: true },
    });
    const ms = rows.reduce((s, r) => s + (r.clockOutTime!.getTime() - r.clockInTime!.getTime()), 0);
    return round(ms / 3_600_000);
  }

  /** Year-to-date payroll: sum of final_total from the financial-year start up to this month. */
  private async ytdPayroll(businessId: number, userId: number, month: Date, fyStartMonth: number) {
    const y = month.getUTCFullYear();
    const fyStart =
      month.getUTCMonth() + 1 >= fyStartMonth
        ? new Date(Date.UTC(y, fyStartMonth - 1, 1))
        : new Date(Date.UTC(y - 1, fyStartMonth - 1, 1));
    const rows = await this.prisma.payroll.findMany({
      where: { businessId, userId, month: { gte: fyStart, lte: month } },
      select: { finalTotal: true },
    });
    return round(rows.reduce((s, r) => s + Number(r.finalTotal), 0));
  }
}
