import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type {
  CreateAllowanceDeductionDto,
  UpdateAllowanceDeductionDto,
} from './dto/allowance-deduction.dto';

const fmt = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');
const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();
const mapType = (t?: string) => (t === 'deduction' ? 'DEDUCTION' : 'ALLOWANCE');
const mapAmountType = (t?: string) => (t === 'percent' ? 'PERCENT' : 'FIXED');

type Row = Prisma.EssentialsAllowanceAndDeductionGetPayload<{
  include: { users: { include: { user: true } } };
}>;

@Injectable()
export class AllowanceDeductionsService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(a: Row) {
    return {
      id: a.id,
      description: a.description,
      type: a.type.toLowerCase(), // allowance | deduction
      amount: Number(a.amount),
      amountType: a.amountType.toLowerCase(), // fixed | percent
      applicableDate: fmt(a.applicableDate),
      employees: a.users.map((u) => u.userId),
      employeeNames: a.users.map((u) => fullName(u.user)),
    };
  }

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const s = query.search.trim();
    const where: Prisma.EssentialsAllowanceAndDeductionWhereInput = {
      businessId,
      ...(s ? { description: { contains: s, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.essentialsAllowanceAndDeduction.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { description: 'asc' },
        include: { users: { include: { user: true } } },
      }),
      this.prisma.essentialsAllowanceAndDeduction.count({ where }),
    ]);
    return { data: rows.map((r) => this.shape(r)), total };
  }

  async findOne(businessId: number, id: number) {
    const a = await this.prisma.essentialsAllowanceAndDeduction.findFirst({
      where: { id, businessId },
      include: { users: { include: { user: true } } },
    });
    if (!a) throw new NotFoundException('Pay component not found');
    return this.shape(a);
  }

  async create(businessId: number, dto: CreateAllowanceDeductionDto) {
    const a = await this.prisma.essentialsAllowanceAndDeduction.create({
      data: {
        businessId,
        description: dto.description,
        type: mapType(dto.type),
        amount: dto.amount,
        amountType: mapAmountType(dto.amountType),
        applicableDate: dto.applicableDate ? new Date(dto.applicableDate) : null,
      },
    });
    if (dto.employees?.length) {
      await this.prisma.essentialsUserAllowanceAndDeduction.createMany({
        data: dto.employees.map((userId) => ({ userId, allowanceDeductionId: a.id })),
        skipDuplicates: true,
      });
    }
    return this.findOne(businessId, a.id);
  }

  async update(businessId: number, id: number, dto: UpdateAllowanceDeductionDto) {
    await this.findOne(businessId, id);
    const data: Prisma.EssentialsAllowanceAndDeductionUncheckedUpdateInput = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.type !== undefined) data.type = mapType(dto.type);
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.amountType !== undefined) data.amountType = mapAmountType(dto.amountType);
    if (dto.applicableDate !== undefined)
      data.applicableDate = dto.applicableDate ? new Date(dto.applicableDate) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.essentialsAllowanceAndDeduction.update({ where: { id }, data });
      if (dto.employees !== undefined) {
        await tx.essentialsUserAllowanceAndDeduction.deleteMany({ where: { allowanceDeductionId: id } });
        if (dto.employees.length) {
          await tx.essentialsUserAllowanceAndDeduction.createMany({
            data: dto.employees.map((userId) => ({ userId, allowanceDeductionId: id })),
            skipDuplicates: true,
          });
        }
      }
    });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    await this.prisma.essentialsAllowanceAndDeduction.delete({ where: { id } });
    return { success: true };
  }
}
