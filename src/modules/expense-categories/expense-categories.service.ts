import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveExpenseCategoryDto } from './dto/save-expense-category.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /expense-categories — full list for the management page, each with its parent's name. */
  async findAll(businessId: number) {
    const rows = await this.prisma.expenseCategory.findMany({
      where: { businessId, deletedAt: null },
      include: { parent: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return {
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code ?? '',
        parentId: c.parentId,
        parentName: c.parent?.name ?? null,
      })),
    };
  }

  /** GET /expense-categories/dropdown — main categories only (parent_id null), for the category select. */
  async forDropdown(businessId: number) {
    const rows = await this.prisma.expenseCategory.findMany({
      where: { businessId, deletedAt: null, parentId: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { data: rows };
  }

  /** GET /expense-categories/:id/sub-categories — children of a category (GOURI getSubCategories). */
  async subCategories(businessId: number, parentId: number) {
    const rows = await this.prisma.expenseCategory.findMany({
      where: { businessId, deletedAt: null, parentId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { data: rows };
  }

  async findOne(businessId: number, id: number) {
    const c = await this.prisma.expenseCategory.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!c) throw new NotFoundException('Expense category not found');
    return { id: c.id, name: c.name, code: c.code ?? '', parentId: c.parentId };
  }

  async create(businessId: number, dto: SaveExpenseCategoryDto) {
    const parentId = dto.parent_id ?? null;
    if (parentId) await this.assertParent(businessId, parentId);
    const row = await this.prisma.expenseCategory.create({
      data: { businessId, name: dto.name, code: blank(dto.code), parentId },
    });
    return this.findOne(businessId, row.id);
  }

  async update(businessId: number, id: number, dto: SaveExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Expense category not found');

    const parentId = dto.parent_id ?? null;
    if (parentId) {
      if (parentId === id) throw new BadRequestException('A category cannot be its own parent');
      await this.assertParent(businessId, parentId);
    }
    await this.prisma.expenseCategory.update({
      where: { id },
      data: { name: dto.name, code: blank(dto.code), parentId },
    });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    const existing = await this.prisma.expenseCategory.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Expense category not found');

    const childCount = await this.prisma.expenseCategory.count({
      where: { parentId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new ConflictException('This category has sub-categories and cannot be deleted');
    }
    const inUse = await this.prisma.transaction.count({
      where: { OR: [{ expenseCategoryId: id }, { expenseSubCategoryId: id }] },
    });
    if (inUse > 0) throw new ConflictException('This category is used by expenses and cannot be deleted');

    await this.prisma.expenseCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  private async assertParent(businessId: number, parentId: number): Promise<void> {
    const parent = await this.prisma.expenseCategory.findFirst({
      where: { id: parentId, businessId, deletedAt: null },
    });
    if (!parent) throw new BadRequestException('Selected parent category is invalid');
    if (parent.parentId) throw new BadRequestException('Only one level of sub-categories is allowed');
  }
}
