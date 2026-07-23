import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveClaimCategoryDto } from './dto/claim.dto';
import type { ClaimCategoriesQueryDto } from './dto/claims-query.dto';

@Injectable()
export class ClaimCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(c: Prisma.ClaimReimbursementCategoryGetPayload<{ include: { parent: true } }>) {
    return {
      id: c.id,
      name: c.name,
      code: c.code ?? '',
      parentId: c.parentId,
      parentName: c.parent?.name ?? null,
      isSubCategory: c.parentId != null,
    };
  }

  /** Parent categories only — for the "add as sub-category" parent dropdown. */
  async parents(businessId: number) {
    return this.prisma.claimReimbursementCategory.findMany({
      where: { businessId, deletedAt: null, parentId: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAll(businessId: number, query: ClaimCategoriesQueryDto) {
    const s = query.search.trim();
    const where: Prisma.ClaimReimbursementCategoryWhereInput = {
      businessId,
      deletedAt: null,
      ...(s
        ? {
            OR: [
              { name: { contains: s, mode: 'insensitive' } },
              { code: { contains: s, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.claimReimbursementCategory.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        // Parents first, then their sub-categories — mirrors GOURI's "--" prefixed listing.
        orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
        include: { parent: true },
      }),
      this.prisma.claimReimbursementCategory.count({ where }),
    ]);
    return { data: rows.map((r) => this.shape(r)), total };
  }

  async findOne(businessId: number, id: number) {
    const c = await this.prisma.claimReimbursementCategory.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { parent: true },
    });
    if (!c) throw new NotFoundException('Category not found');
    return this.shape(c);
  }

  /** A valid parent must exist in the business and itself be a top-level category (no nesting past 1). */
  private async resolveParent(businessId: number, parentId?: number, selfId?: number): Promise<number | null> {
    if (!parentId) return null;
    if (selfId && parentId === selfId) throw new BadRequestException('A category cannot be its own parent');
    const parent = await this.prisma.claimReimbursementCategory.findFirst({
      where: { id: parentId, businessId, deletedAt: null },
    });
    if (!parent) throw new BadRequestException('Selected parent category is invalid');
    if (parent.parentId != null) throw new BadRequestException('Sub-categories cannot be nested further');
    return parentId;
  }

  async create(businessId: number, dto: SaveClaimCategoryDto) {
    const parentId = await this.resolveParent(businessId, dto.parentId);
    const c = await this.prisma.claimReimbursementCategory.create({
      data: { businessId, name: dto.name, code: dto.code ?? null, parentId },
    });
    return this.findOne(businessId, c.id);
  }

  async update(businessId: number, id: number, dto: SaveClaimCategoryDto) {
    await this.findOne(businessId, id);
    const parentId = await this.resolveParent(businessId, dto.parentId, id);
    await this.prisma.claimReimbursementCategory.update({
      where: { id },
      data: { name: dto.name, code: dto.code ?? null, parentId },
    });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    // A category in use by a claim, or a parent of sub-categories, can't be silently orphaned.
    const [claimCount, childCount] = await this.prisma.$transaction([
      this.prisma.claimReimbursement.count({ where: { businessId, categoryId: id } }),
      this.prisma.claimReimbursementCategory.count({ where: { businessId, parentId: id, deletedAt: null } }),
    ]);
    if (claimCount > 0) throw new BadRequestException('This category is used by one or more claims');
    if (childCount > 0) throw new BadRequestException('Remove the sub-categories first');
    await this.prisma.claimReimbursementCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }
}
