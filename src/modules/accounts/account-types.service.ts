import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveAccountTypeDto } from './dto/accounts.dto';

/** Account Types — a strict 2-level tree (parent → sub), hard-deleted (GOURI has no soft-delete here). */
@Injectable()
export class AccountTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(businessId: number) {
    const rows = await this.prisma.accountType.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
    });
    const parents = rows.filter((r) => r.parentAccountTypeId == null);
    const tree = parents.map((p) => ({
      id: p.id,
      name: p.name,
      children: rows
        .filter((r) => r.parentAccountTypeId === p.id)
        .map((c) => ({ id: c.id, name: c.name })),
    }));
    return { data: rows.map((r) => ({ id: r.id, name: r.name, parentAccountTypeId: r.parentAccountTypeId })), tree };
  }

  /** Grouped options for the account form's <optgroup> select. */
  async grouped(businessId: number) {
    const { tree } = await this.findAll(businessId);
    return { data: tree };
  }

  private async assertValidParent(businessId: number, parentId: number, selfId?: number) {
    if (selfId && parentId === selfId) throw new BadRequestException('A type cannot be its own parent');
    const parent = await this.prisma.accountType.findFirst({ where: { id: parentId, businessId } });
    if (!parent) throw new BadRequestException('Invalid parent account type');
    if (parent.parentAccountTypeId != null) {
      throw new BadRequestException('Account types support only two levels (a sub-type cannot be a parent)');
    }
  }

  private async hasChildren(id: number): Promise<boolean> {
    return (await this.prisma.accountType.count({ where: { parentAccountTypeId: id } })) > 0;
  }

  async create(businessId: number, dto: SaveAccountTypeDto) {
    if (dto.parentAccountTypeId) await this.assertValidParent(businessId, dto.parentAccountTypeId);
    const row = await this.prisma.accountType.create({
      data: { businessId, name: dto.name, parentAccountTypeId: dto.parentAccountTypeId ?? null },
    });
    return { id: row.id, name: row.name, parentAccountTypeId: row.parentAccountTypeId };
  }

  async update(businessId: number, id: number, dto: SaveAccountTypeDto) {
    const existing = await this.prisma.accountType.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Account type not found');
    if (dto.parentAccountTypeId) {
      await this.assertValidParent(businessId, dto.parentAccountTypeId, id);
      // A parent that still has its own sub-types cannot itself become a sub-type (keeps 2 levels).
      if (await this.hasChildren(id)) {
        throw new BadRequestException('This type has sub-types — move them out before making it a sub-type');
      }
    }
    const row = await this.prisma.accountType.update({
      where: { id },
      data: { name: dto.name, parentAccountTypeId: dto.parentAccountTypeId ?? null },
    });
    return { id: row.id, name: row.name, parentAccountTypeId: row.parentAccountTypeId };
  }

  async remove(businessId: number, id: number) {
    const existing = await this.prisma.accountType.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Account type not found');
    // Hard delete — children's parent and any account's account_type_id are set NULL by the FKs.
    await this.prisma.accountType.delete({ where: { id } });
    return { success: true, msg: 'Account type deleted' };
  }
}
