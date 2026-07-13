import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AbilityService } from '../../common/services/ability.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import type { GeneratePayrollDto, PayrollQueryDto, PreparePayrollDto } from './dto/payroll.dto';

const VIEW_ALL = 'essentials.view_all_payroll';

const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();
const round = (n: number): number => Math.round(n * 100) / 100;
const monthDate = (m: string): Date => new Date(`${m}-01T00:00:00`);
const monthLabel = (d: Date): string =>
  d.toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ability: AbilityService,
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

  /** Mark a whole group paid (and its payrolls). */
  async payGroup(businessId: number, id: number) {
    const g = await this.prisma.payrollGroup.findFirst({ where: { id, businessId } });
    if (!g) throw new NotFoundException('Payroll group not found');
    await this.prisma.$transaction([
      this.prisma.payroll.updateMany({ where: { payrollGroupId: id }, data: { paymentStatus: 'PAID' } }),
      this.prisma.payrollGroup.update({ where: { id }, data: { paymentStatus: 'PAID' } }),
    ]);
    return this.getGroup(businessId, id);
  }
}
