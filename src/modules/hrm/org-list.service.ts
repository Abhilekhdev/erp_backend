import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CreateOrgItemDto, UpdateOrgItemDto } from './dto/org-item.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

interface OrgRow {
  id: number;
  businessId: number;
  name: string;
  shortCode: string | null;
  description: string | null;
}

// The subset of a Prisma model delegate this base needs. Department & Designation delegates both
// satisfy it structurally; subclasses cast their delegate to this (the only place the cast lives).
export interface OrgDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    skip?: number;
    take?: number;
    orderBy?: Record<string, unknown>;
  }): Promise<OrgRow[]>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findFirst(args: { where: Record<string, unknown> }): Promise<OrgRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<OrgRow>;
  update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<OrgRow>;
}

const shape = (r: OrgRow) => ({
  id: r.id,
  name: r.name,
  shortCode: r.shortCode,
  description: r.description,
});

/**
 * Generic CRUD for the flat, business-scoped employee org lists (Departments, Designations).
 * Both are structurally identical in GOURI (`categories` rows keyed by category_type); here they
 * are separate tables driven by this one base. Soft-delete + case-insensitive name uniqueness.
 */
export abstract class OrgListService {
  protected abstract get delegate(): OrgDelegate;
  protected abstract get label(): string; // e.g. 'Department'

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const s = query.search.trim();
    const where: Record<string, unknown> = {
      businessId,
      deletedAt: null,
      ...(s
        ? {
            OR: [
              { name: { contains: s, mode: 'insensitive' } },
              { shortCode: { contains: s, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.delegate.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.delegate.count({ where }),
    ]);
    return { data: rows.map(shape), total };
  }

  async findOne(businessId: number, id: number) {
    const row = await this.delegate.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!row) throw new NotFoundException(`${this.label} not found`);
    return shape(row);
  }

  async create(businessId: number, userId: number, dto: CreateOrgItemDto) {
    await this.assertUniqueName(businessId, dto.name);
    const row = await this.delegate.create({
      data: {
        businessId,
        name: dto.name,
        shortCode: blank(dto.shortCode),
        description: blank(dto.description),
        createdBy: userId,
      },
    });
    return this.findOne(businessId, row.id);
  }

  async update(businessId: number, id: number, dto: UpdateOrgItemDto) {
    await this.findOne(businessId, id); // 404s if not in this business
    if (dto.name !== undefined) await this.assertUniqueName(businessId, dto.name, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortCode !== undefined) data.shortCode = blank(dto.shortCode);
    if (dto.description !== undefined) data.description = blank(dto.description);
    await this.delegate.update({ where: { id }, data });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    await this.delegate.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  private async assertUniqueName(businessId: number, name: string, exceptId?: number): Promise<void> {
    const found = await this.delegate.findFirst({
      where: {
        businessId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (found) {
      throw new ConflictException(`A ${this.label.toLowerCase()} with this name already exists`);
    }
  }
}
