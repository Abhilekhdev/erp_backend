import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveCategoryDto } from './dto/save-category.dto';

const PRODUCT = 'product';
const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

type CategoryRow = Prisma.CategoryGetPayload<{ include: { parent: true } }>;

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(c: CategoryRow) {
    return {
      id: c.id,
      name: c.name,
      shortCode: c.shortCode ?? '',
      description: c.description ?? '',
      parentId: c.parentId,
      parentName: c.parent ? c.parent.name : null,
      isSubCategory: c.parentId != null,
    };
  }

  /** GET /categories — parents first, each followed by its sub-categories (GOURI catAndSubCategories). */
  async findAll(businessId: number) {
    const rows = await this.prisma.category.findMany({
      where: { businessId, categoryType: PRODUCT, deletedAt: null },
      include: { parent: true },
      orderBy: { name: 'asc' },
    });
    const parents = rows.filter((r) => r.parentId == null);
    const subsByParent = new Map<number, CategoryRow[]>();
    for (const s of rows.filter((r) => r.parentId != null)) {
      const list = subsByParent.get(s.parentId as number) ?? [];
      list.push(s);
      subsByParent.set(s.parentId as number, list);
    }
    const parentIds = new Set(parents.map((p) => p.id));
    const out: ReturnType<typeof this.shape>[] = [];
    for (const p of parents) {
      out.push(this.shape(p));
      for (const s of subsByParent.get(p.id) ?? []) out.push(this.shape(s));
    }
    // Sub-categories whose parent was deleted — still surface them (orphans).
    for (const s of rows) {
      if (s.parentId != null && !parentIds.has(s.parentId)) out.push(this.shape(s));
    }
    return { data: out };
  }

  /** GET /categories/dropdown — top-level categories only (the parent picker for sub-categories). */
  async forDropdown(businessId: number) {
    const rows = await this.prisma.category.findMany({
      where: { businessId, categoryType: PRODUCT, deletedAt: null, parentId: null },
      select: { id: true, name: true, shortCode: true },
      orderBy: { name: 'asc' },
    });
    return {
      data: rows.map((c) => ({ id: c.id, name: c.shortCode ? `${c.name} - ${c.shortCode}` : c.name })),
    };
  }

  async findOne(businessId: number, id: number) {
    const row = await this.prisma.category.findFirst({
      where: { id, businessId, categoryType: PRODUCT, deletedAt: null },
      include: { parent: true },
    });
    if (!row) throw new NotFoundException('Category not found');
    return this.shape(row);
  }

  /** Resolve the parent: only a sub-category flag + a valid top-level parent make this a sub-category. */
  private async resolveParent(businessId: number, dto: SaveCategoryDto, selfId?: number): Promise<number | null> {
    if (!dto.add_as_sub_category || dto.parent_id == null) return null;
    if (dto.parent_id === selfId) throw new BadRequestException('A category cannot be its own parent');
    const parent = await this.prisma.category.findFirst({
      where: { id: dto.parent_id, businessId, categoryType: PRODUCT, deletedAt: null },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new BadRequestException('Selected parent category is invalid');
    if (parent.parentId != null) {
      throw new BadRequestException('Parent must be a top-level category (one level of sub-categories)');
    }
    return dto.parent_id;
  }

  async create(businessId: number, createdBy: number, dto: SaveCategoryDto) {
    const parentId = await this.resolveParent(businessId, dto);
    const row = await this.prisma.category.create({
      data: {
        businessId,
        createdBy,
        categoryType: PRODUCT,
        name: dto.name,
        shortCode: blank(dto.short_code),
        description: blank(dto.description),
        parentId,
        createdAt: new Date(),
      },
    });
    return this.findOne(businessId, row.id);
  }

  async update(businessId: number, id: number, dto: SaveCategoryDto) {
    await this.findOne(businessId, id);
    const parentId = await this.resolveParent(businessId, dto, id);
    await this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        shortCode: blank(dto.short_code),
        description: blank(dto.description),
        parentId,
      },
    });
    return this.findOne(businessId, id);
  }

  /** DELETE /categories/:id — soft delete. Blocked while it still has sub-categories. */
  async remove(businessId: number, id: number) {
    const row = await this.prisma.category.findFirst({
      where: { id, businessId, categoryType: PRODUCT, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Category not found');
    const subCount = await this.prisma.category.count({
      where: { businessId, parentId: id, deletedAt: null },
    });
    if (subCount > 0) {
      throw new BadRequestException('This category has sub-categories — remove those first');
    }
    // NOTE: GOURI also blocks/handles categories referenced by products — add once Products exists.
    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true, msg: 'Category deleted successfully' };
  }
}
