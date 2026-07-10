import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const MARITAL: Record<string, 'MARRIED' | 'UNMARRIED' | 'DIVORCED'> = {
  married: 'MARRIED',
  unmarried: 'UNMARRIED',
  divorced: 'DIVORCED',
};
const mapMarital = (v?: string): 'MARRIED' | 'UNMARRIED' | 'DIVORCED' | null =>
  v && MARITAL[v] ? MARITAL[v] : null;

const ACCESS_ALL = 'access_all_locations';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const search = query.search.trim();
    const where: Prisma.UserWhereInput = {
      businessId,
      userType: 'USER',
      deletedAt: null,
      isCmmsnAgnt: false, // commission agents are managed in their own module (mirrors ManageUserController::index)
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { username: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { firstName: 'asc' },
        include: { roles: { include: { role: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data = rows.map((u) => ({
      id: u.id,
      name: [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
      email: u.email,
      username: u.username,
      allowLogin: u.allowLogin,
      status: u.status.toLowerCase(),
      role: u.roles[0]?.role.name ?? '—',
      isAdmin: u.roles[0]?.role.name === 'Admin',
    }));
    return { data, total };
  }

  async meta(businessId: number, isAdmin: boolean) {
    const [roles, locations, managers, departments, designations, activityCodes, payComponents, leaveTypes] =
      await this.prisma.$transaction([
        this.prisma.role.findMany({
          // Non-admins cannot assign the Admin role (mirrors ManageUserController::getRolesArray).
          where: { businessId, ...(isAdmin ? {} : { name: { not: 'Admin' } }) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.businessLocation.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        // Candidate superiors for the "Manager" (parent_id) field.
        this.prisma.user.findMany({
          where: { businessId, userType: 'USER', deletedAt: null },
          select: { id: true, surname: true, firstName: true, lastName: true },
          orderBy: { firstName: 'asc' },
        }),
        this.prisma.department.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.designation.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        // Activity codes (option label = code, falling back to name — mirrors EssentialsActivityLog::forDropdown).
        this.prisma.activityCode.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, activityCode: true, activityName: true },
          orderBy: { activityName: 'asc' },
        }),
        // Pay components (allowances & deductions) — label = description.
        this.prisma.essentialsAllowanceAndDeduction.findMany({
          where: { businessId },
          select: { id: true, description: true, type: true },
          orderBy: { description: 'asc' },
        }),
        this.prisma.leaveType.findMany({
          where: { businessId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);
    return {
      roles,
      locations,
      departments,
      designations,
      leaveTypes,
      activityCodes: activityCodes.map((a) => ({ id: a.id, name: a.activityCode || a.activityName })),
      payComponents: payComponents.map((p) => ({
        id: p.id,
        name: `${p.description} (${p.type === 'ALLOWANCE' ? 'Allowance' : 'Deduction'})`,
      })),
      managers: managers.map((m) => ({
        id: m.id,
        name: [m.surname, m.firstName, m.lastName].filter(Boolean).join(' ').trim(),
      })),
    };
  }

  async findOne(businessId: number, id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, businessId, deletedAt: null },
      include: {
        roles: true,
        locations: true,
        permissions: { include: { permission: true } },
        contactAccess: true,
        allowanceDeductions: true,
        leaveBalances: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // activity_codes is a legacy JSON array of ids (stored as strings by Laravel's json_encode).
    const activityCodeIds = Array.isArray(user.activityCodes)
      ? (user.activityCodes as (string | number)[]).map(Number).filter((n) => !Number.isNaN(n))
      : [];

    return {
      id: user.id,
      surname: user.surname,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      username: user.username,
      allowLogin: user.allowLogin,
      isActive: user.status === 'ACTIVE',
      roleId: user.roles[0]?.roleId ?? null,
      isCmmsnAgnt: user.isCmmsnAgnt,
      cmmsnPercent: Number(user.cmmsnPercent),
      maxSalesDiscountPercent:
        user.maxSalesDiscountPercent != null ? Number(user.maxSalesDiscountPercent) : null,
      parentId: user.parentId,
      // Employment (HRM)
      essentialsDepartmentId: user.essentialsDepartmentId,
      essentialsDesignationId: user.essentialsDesignationId,
      essentialsSalary: user.essentialsSalary != null ? Number(user.essentialsSalary) : null,
      essentialsPayPeriod: user.essentialsPayPeriod ?? '',
      locationId: user.locationId,
      activityCodes: activityCodeIds,
      payComponents: user.allowanceDeductions.map((a) => a.allowanceDeductionId),
      leaveTypeIds: user.leaveBalances.map((b) => b.leaveTypeId),
      dob: user.dob ? user.dob.toISOString().slice(0, 10) : '',
      gender: user.gender ?? '',
      maritalStatus: user.maritalStatus ? user.maritalStatus.toLowerCase() : '',
      bloodGroup: user.bloodGroup ?? '',
      contactNumber: user.contactNumber ?? '',
      altNumber: user.altNumber ?? '',
      familyNumber: user.familyNumber ?? '',
      fbLink: user.fbLink ?? '',
      twitterLink: user.twitterLink ?? '',
      socialMedia1: user.socialMedia1 ?? '',
      socialMedia2: user.socialMedia2 ?? '',
      customField1: user.customField1 ?? '',
      customField2: user.customField2 ?? '',
      customField3: user.customField3 ?? '',
      customField4: user.customField4 ?? '',
      guardianName: user.guardianName ?? '',
      idProofName: user.idProofName ?? '',
      idProofNumber: user.idProofNumber ?? '',
      permanentAddress: user.permanentAddress ?? '',
      currentAddress: user.currentAddress ?? '',
      bankDetails: user.bankDetails ? (JSON.parse(user.bankDetails) as Record<string, string>) : null,
      accessAllLocations: user.permissions.some((p) => p.permission.name === ACCESS_ALL),
      locationIds: user.locations.map((l) => l.locationId),
      selectedContacts: user.selectedContacts,
      contactIds: user.contactAccess.map((c) => c.contactId),
    };
  }

  async create(businessId: number, dto: CreateUserDto) {
    await this.assertUnique(dto.email, dto.username);
    const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, businessId } });
    if (!role) throw new BadRequestException('Selected role is invalid');
    await this.assertHrmRefs(businessId, dto);

    const allowLogin = dto.allowLogin ?? true;
    if (allowLogin && !dto.password) {
      throw new BadRequestException('Password is required when login is allowed');
    }
    // Every user carries a password hash (matches Laravel — the column is NOT NULL). Login is
    // gated by `allowLogin`, so non-login users get an unguessable random password.
    const passwordHash = await this.passwords.hash(
      dto.password && dto.password.length ? dto.password : randomBytes(24).toString('base64'),
    );

    // A login-enabled user always ends up with a username (auto-generated when blank), like Laravel.
    const username = allowLogin
      ? await this.resolveUsername(dto.username, dto.firstName, dto.email)
      : null;

    // A brand-new user has no existing rows, so the create path only INSERTs — it skips the
    // deleteMany/findMany diffing the update path needs. That keeps this multi-write transaction to
    // the minimum number of round-trips (important on serverless Postgres).
    const userId = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          businessId,
          userType: 'USER',
          firstName: dto.firstName,
          email: dto.email,
          ...this.profileData(dto),
          isCmmsnAgnt: false, // commission agents are created in their own module, not here
          username,
          passwordHash,
          allowLogin,
          status: (dto.isActive ?? true) ? 'ACTIVE' : 'INACTIVE',
          language: 'en',
        },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: dto.roleId } });

      if (dto.accessAllLocations) {
        const permId = await this.getAccessAllPermissionId(tx);
        await tx.userPermission.create({ data: { userId: user.id, permissionId: permId } });
      } else if (dto.locationIds?.length) {
        await tx.userLocation.createMany({
          data: dto.locationIds.map((locationId) => ({ userId: user.id, locationId })),
          skipDuplicates: true,
        });
      }
      if (dto.selectedContacts && dto.contactIds?.length) {
        await tx.userContactAccess.createMany({
          data: dto.contactIds.map((contactId) => ({ userId: user.id, contactId })),
          skipDuplicates: true,
        });
      }
      if (dto.payComponents?.length) {
        await tx.essentialsUserAllowanceAndDeduction.createMany({
          data: [...new Set(dto.payComponents)].map((allowanceDeductionId) => ({
            userId: user.id,
            allowanceDeductionId,
          })),
          skipDuplicates: true,
        });
      }
      if (dto.leaveTypeIds?.length) {
        await tx.userLeaveBalance.createMany({
          data: [...new Set(dto.leaveTypeIds)].map((leaveTypeId) => ({
            businessId,
            userId: user.id,
            leaveTypeId,
          })),
          skipDuplicates: true,
        });
      }
      return user.id;
    });

    return this.findOne(businessId, userId);
  }

  async update(businessId: number, id: number, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');

    if (dto.email && dto.email !== user.email) await this.assertUniqueEmail(dto.email, id);
    if (dto.username && dto.username !== user.username) await this.assertUniqueUsername(dto.username, id);
    await this.assertHrmRefs(businessId, dto);

    // Role change — cannot strip the last Admin's Admin role.
    if (dto.roleId !== undefined && dto.roleId !== user.roles[0]?.roleId) {
      const newRole = await this.prisma.role.findFirst({ where: { id: dto.roleId, businessId } });
      if (!newRole) throw new BadRequestException('Selected role is invalid');
      const wasAdmin = user.roles[0]?.role.name === 'Admin';
      if (wasAdmin && newRole.name !== 'Admin') {
        const adminRole = await this.prisma.role.findFirst({ where: { businessId, name: 'Admin' } });
        const adminCount = adminRole
          ? await this.prisma.userRole.count({ where: { roleId: adminRole.id } })
          : 0;
        if (adminCount <= 1) {
          throw new ForbiddenException('Cannot change the role of the only administrator');
        }
      }
    }

    const allowLogin = dto.allowLogin ?? user.allowLogin;
    // Only touch columns the caller actually sent — a partial PATCH must NOT reset unlisted fields.
    const data = this.buildUpdateData(dto);

    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.isActive !== undefined) data.status = dto.isActive ? 'ACTIVE' : 'INACTIVE';
    if (dto.allowLogin !== undefined) data.allowLogin = allowLogin;
    if (!allowLogin) {
      // Disabling login clears the username; the password hash is retained (login is gated by the flag).
      data.username = null;
    } else {
      if (dto.username !== undefined) data.username = blank(dto.username);
      if (dto.password) data.passwordHash = await this.passwords.hash(dto.password);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data });

      if (dto.roleId !== undefined) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.create({ data: { userId: id, roleId: dto.roleId } });
      }
      if (dto.accessAllLocations !== undefined || dto.locationIds !== undefined) {
        await this.setLocationAccess(tx, id, dto.accessAllLocations ?? false, dto.locationIds ?? []);
      }
      if (dto.selectedContacts !== undefined) {
        await tx.userContactAccess.deleteMany({ where: { userId: id } });
        if (dto.selectedContacts && dto.contactIds?.length) {
          await tx.userContactAccess.createMany({
            data: dto.contactIds.map((contactId) => ({ userId: id, contactId })),
            skipDuplicates: true,
          });
        }
      }
      if (dto.payComponents !== undefined) await this.syncPayComponents(tx, id, dto.payComponents);
      if (dto.leaveTypeIds !== undefined) await this.syncLeaveTypes(tx, businessId, id, dto.leaveTypeIds);
    });

    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.roles[0]?.role.name === 'Admin') {
      const adminRole = await this.prisma.role.findFirst({ where: { businessId, name: 'Admin' } });
      const adminCount = adminRole
        ? await this.prisma.userRole.count({ where: { roleId: adminRole.id } })
        : 0;
      if (adminCount <= 1) throw new ForbiddenException('Cannot delete the only administrator');
    }

    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  // ── helpers ──────────────────────────────────────────
  // Plain scalar profile fields for CREATE (concrete values, every column set from the DTO defaults).
  private profileData(dto: CreateUserDto) {
    return {
      surname: blank(dto.surname),
      lastName: blank(dto.lastName),
      cmmsnPercent: dto.cmmsnPercent ?? 0,
      maxSalesDiscountPercent: dto.maxSalesDiscountPercent ?? null,
      selectedContacts: dto.selectedContacts ?? false,
      parentId: dto.parentId ?? null,
      // Employment (HRM)
      essentialsDepartmentId: dto.essentialsDepartmentId ?? null,
      essentialsDesignationId: dto.essentialsDesignationId ?? null,
      essentialsSalary: dto.essentialsSalary ?? null,
      essentialsPayPeriod: blank(dto.essentialsPayPeriod),
      locationId: dto.locationId ?? null,
      activityCodes: dto.activityCodes ?? [], // legacy JSON array of activity-code ids
      dob: dto.dob ? new Date(dto.dob) : null,
      gender: blank(dto.gender),
      maritalStatus: mapMarital(dto.maritalStatus),
      bloodGroup: blank(dto.bloodGroup),
      contactNumber: blank(dto.contactNumber),
      altNumber: blank(dto.altNumber),
      familyNumber: blank(dto.familyNumber),
      fbLink: blank(dto.fbLink),
      twitterLink: blank(dto.twitterLink),
      socialMedia1: blank(dto.socialMedia1),
      socialMedia2: blank(dto.socialMedia2),
      customField1: blank(dto.customField1),
      customField2: blank(dto.customField2),
      customField3: blank(dto.customField3),
      customField4: blank(dto.customField4),
      guardianName: blank(dto.guardianName),
      idProofName: blank(dto.idProofName),
      idProofNumber: blank(dto.idProofNumber),
      permanentAddress: blank(dto.permanentAddress),
      currentAddress: blank(dto.currentAddress),
      bankDetails: dto.bankDetails ? JSON.stringify(dto.bankDetails) : null,
    };
  }

  // Simple string columns whose DTO key == Prisma key (each nulled when the sent value is blank).
  private static readonly UPDATE_STRING_FIELDS = [
    'surname', 'lastName', 'gender', 'bloodGroup', 'contactNumber', 'altNumber', 'familyNumber',
    'fbLink', 'twitterLink', 'socialMedia1', 'socialMedia2', 'customField1', 'customField2',
    'customField3', 'customField4', 'guardianName', 'idProofName', 'idProofNumber',
    'permanentAddress', 'currentAddress',
  ] as const;

  /**
   * Build a partial UPDATE payload that ONLY includes the profile columns the caller actually
   * sent (`!== undefined`). This preserves the PATCH contract — omitted fields are left untouched
   * rather than reset — while our full-form UI still clears fields by sending '' (→ null) or an
   * explicit null (parentId). Identity/login columns are handled by update() directly.
   */
  private buildUpdateData(dto: UpdateUserDto): Prisma.UserUncheckedUpdateInput {
    const data: Prisma.UserUncheckedUpdateInput = {};
    const src = dto as Record<string, unknown>;
    for (const f of UsersService.UPDATE_STRING_FIELDS) {
      if (src[f] !== undefined) (data as Record<string, unknown>)[f] = blank(src[f] as string);
    }
    if (dto.maritalStatus !== undefined) data.maritalStatus = mapMarital(dto.maritalStatus);
    if (dto.dob !== undefined) data.dob = dto.dob ? new Date(dto.dob) : null;
    if (dto.cmmsnPercent !== undefined) data.cmmsnPercent = dto.cmmsnPercent;
    if (dto.maxSalesDiscountPercent !== undefined)
      data.maxSalesDiscountPercent = dto.maxSalesDiscountPercent;
    if (dto.parentId !== undefined) data.parentId = dto.parentId; // may be null → clears the manager
    if (dto.essentialsDepartmentId !== undefined)
      data.essentialsDepartmentId = dto.essentialsDepartmentId;
    if (dto.essentialsDesignationId !== undefined)
      data.essentialsDesignationId = dto.essentialsDesignationId;
    if (dto.essentialsSalary !== undefined) data.essentialsSalary = dto.essentialsSalary;
    if (dto.essentialsPayPeriod !== undefined)
      data.essentialsPayPeriod = blank(dto.essentialsPayPeriod);
    if (dto.locationId !== undefined) data.locationId = dto.locationId;
    if (dto.activityCodes !== undefined) data.activityCodes = dto.activityCodes;
    if (dto.selectedContacts !== undefined) data.selectedContacts = dto.selectedContacts;
    if (dto.bankDetails !== undefined)
      data.bankDetails = dto.bankDetails ? JSON.stringify(dto.bankDetails) : null;
    return data;
  }

  /** Provided username wins; otherwise derive a unique one from the email/first name (like Laravel). */
  private async resolveUsername(
    provided: string | undefined,
    firstName: string,
    email: string,
  ): Promise<string> {
    const wanted = blank(provided);
    if (wanted) return wanted; // caller already asserted uniqueness of an explicit username
    const base =
      (email.split('@')[0] || firstName || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 20) ||
      'user';
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}${i}`;
      const exists = await this.prisma.user.findFirst({ where: { username: candidate } });
      if (!exists) return candidate;
    }
    return `${base}${randomBytes(3).toString('hex')}`;
  }

  /** Guard the HRM foreign keys so a caller can't reference another tenant's dept/designation/location. */
  private async assertHrmRefs(
    businessId: number,
    dto: CreateUserDto | UpdateUserDto,
  ): Promise<void> {
    if (dto.essentialsDepartmentId) {
      const dep = await this.prisma.department.findFirst({
        where: { id: dto.essentialsDepartmentId, businessId, deletedAt: null },
      });
      if (!dep) throw new BadRequestException('Selected department is invalid');
    }
    if (dto.essentialsDesignationId) {
      const des = await this.prisma.designation.findFirst({
        where: { id: dto.essentialsDesignationId, businessId, deletedAt: null },
      });
      if (!des) throw new BadRequestException('Selected designation is invalid');
    }
    if (dto.locationId) {
      const loc = await this.prisma.businessLocation.findFirst({
        where: { id: dto.locationId, businessId, deletedAt: null },
      });
      if (!loc) throw new BadRequestException('Selected work location is invalid');
    }
    // Multi-selects: every referenced id must belong to this tenant.
    if (dto.activityCodes?.length) {
      const n = await this.prisma.activityCode.count({
        where: { id: { in: dto.activityCodes }, businessId, deletedAt: null },
      });
      if (n !== new Set(dto.activityCodes).size) {
        throw new BadRequestException('One or more activity codes are invalid');
      }
    }
    if (dto.payComponents?.length) {
      const n = await this.prisma.essentialsAllowanceAndDeduction.count({
        where: { id: { in: dto.payComponents }, businessId },
      });
      if (n !== new Set(dto.payComponents).size) {
        throw new BadRequestException('One or more pay components are invalid');
      }
    }
    if (dto.leaveTypeIds?.length) {
      const n = await this.prisma.leaveType.count({
        where: { id: { in: dto.leaveTypeIds }, businessId, deletedAt: null },
      });
      if (n !== new Set(dto.leaveTypeIds).size) {
        throw new BadRequestException('One or more leave types are invalid');
      }
    }
  }

  /** Replace a user's pay-component (allowance/deduction) assignments — the pivot is stateless. */
  private async syncPayComponents(
    tx: Prisma.TransactionClient,
    userId: number,
    payComponentIds: number[],
  ): Promise<void> {
    await tx.essentialsUserAllowanceAndDeduction.deleteMany({ where: { userId } });
    if (payComponentIds.length) {
      await tx.essentialsUserAllowanceAndDeduction.createMany({
        data: [...new Set(payComponentIds)].map((allowanceDeductionId) => ({ userId, allowanceDeductionId })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * Reconcile a user's assigned leave types. New ids get a balance row (starting at 0); removed ones
   * are deleted. Retained leave types keep their existing balance — mirroring the legacy update, which
   * never wipes accrued balances on an unrelated save.
   */
  private async syncLeaveTypes(
    tx: Prisma.TransactionClient,
    businessId: number,
    userId: number,
    leaveTypeIds: number[],
  ): Promise<void> {
    const wanted = new Set(leaveTypeIds);
    const existing = await tx.userLeaveBalance.findMany({
      where: { userId },
      select: { leaveTypeId: true },
    });
    const have = new Set(existing.map((e) => e.leaveTypeId));

    const toRemove = [...have].filter((id) => !wanted.has(id));
    if (toRemove.length) {
      await tx.userLeaveBalance.deleteMany({ where: { userId, leaveTypeId: { in: toRemove } } });
    }
    const toAdd = [...wanted].filter((id) => !have.has(id));
    if (toAdd.length) {
      await tx.userLeaveBalance.createMany({
        data: toAdd.map((leaveTypeId) => ({ businessId, userId, leaveTypeId })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * The global "access all locations" permission id. It's a single seeded row that never changes,
   * so resolve it once and memoize — this removes a round-trip from every user create/update on Neon.
   */
  private accessAllPermissionId: number | null = null;
  private async getAccessAllPermissionId(tx: Prisma.TransactionClient): Promise<number> {
    if (this.accessAllPermissionId != null) return this.accessAllPermissionId;
    const perm = await tx.permission.upsert({
      where: { name: ACCESS_ALL },
      update: {},
      create: { name: ACCESS_ALL },
    });
    this.accessAllPermissionId = perm.id;
    return perm.id;
  }

  /** Reconcile location access for an EXISTING user (update path — clears then re-sets). */
  private async setLocationAccess(
    tx: Prisma.TransactionClient,
    userId: number,
    accessAll: boolean,
    locationIds: number[],
  ): Promise<void> {
    const permId = await this.getAccessAllPermissionId(tx);
    await tx.userLocation.deleteMany({ where: { userId } });

    if (accessAll) {
      await tx.userPermission.upsert({
        where: { userId_permissionId: { userId, permissionId: permId } },
        create: { userId, permissionId: permId },
        update: {},
      });
    } else {
      await tx.userPermission.deleteMany({ where: { userId, permissionId: permId } });
      if (locationIds.length) {
        await tx.userLocation.createMany({
          data: locationIds.map((locationId) => ({ userId, locationId })),
          skipDuplicates: true,
        });
      }
    }
  }

  private async assertUnique(email: string, username?: string): Promise<void> {
    await this.assertUniqueEmail(email);
    if (username) await this.assertUniqueUsername(username);
  }
  private async assertUniqueEmail(email: string, exceptId?: number): Promise<void> {
    const found = await this.prisma.user.findFirst({
      where: { email, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (found) throw new ConflictException('A user with this email already exists');
  }
  private async assertUniqueUsername(username: string, exceptId?: number): Promise<void> {
    const found = await this.prisma.user.findFirst({
      where: { username, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (found) throw new ConflictException('A user with this username already exists');
  }
}
