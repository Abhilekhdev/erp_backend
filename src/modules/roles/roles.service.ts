import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';

const RESERVED_NAMES = ['Admin']; // Admin is the Gate::before wildcard — cannot be created/edited/deleted

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /** A role is mutable (editable/deletable) if it isn't a default role — except Cashier, which is. */
  private isMutable(role: { isDefault: boolean; name: string }): boolean {
    return !role.isDefault || role.name === 'Cashier';
  }

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const where = {
      businessId,
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        include: { _count: { select: { users: true, permissions: true } } },
      }),
      this.prisma.role.count({ where }),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      isDefault: r.isDefault,
      isServiceStaff: r.isServiceStaff,
      isAdmin: r.name === 'Admin',
      userCount: r._count.users,
      permissionCount: r._count.permissions,
      mutable: this.isMutable(r),
    }));
    return { data, total };
  }

  async findOne(businessId: number, id: number) {
    const role = await this.prisma.role.findFirst({
      where: { id, businessId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return {
      id: role.id,
      name: role.name,
      isDefault: role.isDefault,
      isServiceStaff: role.isServiceStaff,
      isAdmin: role.name === 'Admin',
      mutable: this.isMutable(role),
      permissions: role.permissions.map((rp) => rp.permission.name),
    };
  }

  async create(businessId: number, dto: CreateRoleDto) {
    if (RESERVED_NAMES.includes(dto.name)) {
      throw new ForbiddenException(`"${dto.name}" is a reserved role name`);
    }
    const exists = await this.prisma.role.findUnique({
      where: { businessId_name: { businessId, name: dto.name } },
    });
    if (exists) throw new ConflictException('A role with this name already exists');

    const role = await this.prisma.role.create({
      data: { name: dto.name, businessId, isServiceStaff: dto.isServiceStaff ?? false },
    });
    await this.syncPermissions(role.id, dto.permissions ?? []);
    return this.findOne(businessId, role.id);
  }

  async update(businessId: number, id: number, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({ where: { id, businessId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === 'Admin') throw new ForbiddenException('The Admin role cannot be edited');
    if (!this.isMutable(role)) throw new ForbiddenException('This default role cannot be edited');

    if (dto.name && dto.name !== role.name) {
      if (RESERVED_NAMES.includes(dto.name)) {
        throw new ForbiddenException(`"${dto.name}" is a reserved role name`);
      }
      const clash = await this.prisma.role.findFirst({
        where: { businessId, name: dto.name, id: { not: id } },
      });
      if (clash) throw new ConflictException('A role with this name already exists');
    }

    const data: { name?: string; isServiceStaff?: boolean; isDefault?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isServiceStaff !== undefined) data.isServiceStaff = dto.isServiceStaff;
    // Cashier stops being a default role once customised (matches Laravel).
    if (role.name === 'Cashier') data.isDefault = false;

    await this.prisma.role.update({ where: { id }, data });
    if (dto.permissions !== undefined) await this.syncPermissions(id, dto.permissions);
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    const role = await this.prisma.role.findFirst({
      where: { id, businessId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === 'Admin') throw new ForbiddenException('The Admin role cannot be deleted');
    if (!this.isMutable(role)) throw new ForbiddenException('This default role cannot be deleted');
    if (role._count.users > 0) {
      throw new ConflictException('This role is assigned to users and cannot be deleted');
    }
    await this.prisma.role.delete({ where: { id } });
    return { success: true };
  }

  /** Ensure all permission names exist (auto-create missing), then set the role's permissions. */
  private async syncPermissions(roleId: number, names: string[]): Promise<void> {
    const unique = Array.from(new Set(names.filter(Boolean)));

    if (unique.length > 0) {
      const existing = await this.prisma.permission.findMany({
        where: { name: { in: unique } },
        select: { name: true },
      });
      const existingNames = new Set(existing.map((p) => p.name));
      const missing = unique.filter((n) => !existingNames.has(n));
      if (missing.length > 0) {
        await this.prisma.permission.createMany({
          data: missing.map((name) => {
            const dot = name.indexOf('.');
            return {
              name,
              resource: dot >= 0 ? name.slice(0, dot) : name,
              action: dot >= 0 ? name.slice(dot + 1) : null,
            };
          }),
          skipDuplicates: true,
        });
      }
    }

    const perms = unique.length
      ? await this.prisma.permission.findMany({
          where: { name: { in: unique } },
          select: { id: true },
        })
      : [];

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      ...(perms.length
        ? [
            this.prisma.rolePermission.createMany({
              data: perms.map((p) => ({ roleId, permissionId: p.id })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }
}
