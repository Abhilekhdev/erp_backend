import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PasswordService } from './password.service';
import type { AccessPayload } from './token.service';
import type { RegisterDto } from './dto/register.dto';

export const userInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  permissions: { include: { permission: true } },
  business: true,
} satisfies Prisma.UserInclude;

export type UserWithAuth = Prisma.UserGetPayload<{ include: typeof userInclude }>;

/** Public-facing user shape (roles/permissions resolved, enums lower-cased). */
export interface AuthUserDto {
  id: number;
  firstName: string;
  lastName: string | null;
  surname: string | null;
  email: string;
  username: string | null;
  userType: string;
  status: string;
  businessId: number | null;
  language: string;
  isBusinessAdmin: boolean;
  roles: string[];
  permissions: string[];
  business: { id: number; name: string; logo: string | null } | null;
}

// Default modules enabled for a brand-new business (mirrors Laravel's createNewBusiness).
const DEFAULT_ENABLED_MODULES = [
  'purchases',
  'add_sale',
  'pos_sale',
  'stock_transfers',
  'stock_adjustment',
  'expenses',
];

// The default POS-staff role every new business ships with (mirrors BusinessUtil::createDefaultBusinessRoles).
const CASHIER_PERMISSIONS = [
  'sell.view',
  'sell.create',
  'sell.update',
  'sell.delete',
  'access_all_locations',
  'view_cash_register',
  'close_cash_register',
];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /** Create a business + its owner (admin) user in one transaction, then return the owner. */
  async register(dto: RegisterDto): Promise<UserWithAuth> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const currency = await this.prisma.currency.findUnique({ where: { id: dto.currencyId } });
    if (!currency) throw new BadRequestException('Selected currency does not exist');

    const passwordHash = await this.passwords.hash(dto.password);

    const ownerId = await this.prisma.$transaction(async (tx) => {
      const owner = await tx.user.create({
        data: {
          firstName: dto.ownerFirstName,
          lastName: dto.ownerLastName || null,
          surname: dto.ownerSurname || null,
          email: dto.email,
          passwordHash,
          userType: 'USER',
          status: 'ACTIVE',
          allowLogin: true,
          language: 'en',
        },
      });

      const business = await tx.business.create({
        data: {
          name: dto.businessName,
          currencyId: dto.currencyId,
          ownerId: owner.id,
          timeZone: dto.timeZone || 'Asia/Kolkata',
          fyStartMonth: dto.fyStartMonth ?? 1,
          accountingMethod: (dto.accountingMethod ?? 'fifo').toUpperCase() as 'FIFO' | 'LIFO',
          // Laravel createNewBusiness defaults: inline tax OFF, 25% default profit.
          enableInlineTax: false,
          defaultProfitPercent: 25,
          enabledModules: DEFAULT_ENABLED_MODULES,
          isActive: true,
          createdBy: owner.id,
        },
      });

      await tx.user.update({ where: { id: owner.id }, data: { businessId: business.id } });

      // Tenant Admin role = the Gate::before wildcard. No explicit permissions attached.
      const adminRole = await tx.role.create({
        data: { name: 'Admin', businessId: business.id, isDefault: true },
      });
      await tx.userRole.create({ data: { userId: owner.id, roleId: adminRole.id } });

      // Cashier = the ready-to-assign POS-staff role every new business ships with. Its permissions
      // are seeded; create any that are missing, then link them — kept to a few round-trips so the
      // interactive transaction stays well within its timeout on serverless Postgres.
      const cashierRole = await tx.role.create({
        data: { name: 'Cashier', businessId: business.id, isDefault: true },
      });
      const seeded = await tx.permission.findMany({
        where: { name: { in: CASHIER_PERMISSIONS } },
        select: { name: true },
      });
      const missing = CASHIER_PERMISSIONS.filter((n) => !seeded.some((p) => p.name === n));
      if (missing.length) {
        await tx.permission.createMany({ data: missing.map((name) => ({ name })), skipDuplicates: true });
      }
      const cashierPerms = await tx.permission.findMany({
        where: { name: { in: CASHIER_PERMISSIONS } },
        select: { id: true },
      });
      await tx.rolePermission.createMany({
        data: cashierPerms.map((p) => ({ roleId: cashierRole.id, permissionId: p.id })),
        skipDuplicates: true,
      });

      return owner.id;
    }, { timeout: 20000, maxWait: 15000 });

    return this.prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: userInclude });
  }

  /** Validate credentials + enforce the four Laravel login gates. */
  async validateLogin(email: string, password: string): Promise<UserWithAuth> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: userInclude });
    if (!user || !(await this.passwords.verify(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.business && !user.business.isActive) {
      throw new UnauthorizedException('This business account is inactive');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This user account is not active');
    }
    if (!user.allowLogin) {
      throw new UnauthorizedException('Login is not allowed for this account');
    }
    return user;
  }

  loadUser(id: number): Promise<UserWithAuth> {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude });
  }

  accessPayload(user: UserWithAuth): AccessPayload {
    const roles = user.roles.map((r) => r.role.name);
    return {
      sub: user.id,
      businessId: user.businessId,
      userType: user.userType.toLowerCase(),
      isBusinessAdmin: roles.includes('Admin'),
      roles,
    };
  }

  buildAuthUser(user: UserWithAuth): AuthUserDto {
    const roles = user.roles.map((r) => r.role.name);
    const rolePerms = user.roles.flatMap((r) => r.role.permissions.map((rp) => rp.permission.name));
    const directPerms = user.permissions.map((up) => up.permission.name);

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      surname: user.surname,
      email: user.email,
      username: user.username,
      userType: user.userType.toLowerCase(),
      status: user.status.toLowerCase(),
      businessId: user.businessId,
      language: user.language,
      isBusinessAdmin: roles.includes('Admin'),
      roles,
      permissions: Array.from(new Set([...rolePerms, ...directPerms])),
      business: user.business
        ? { id: user.business.id, name: user.business.name, logo: user.business.logo }
        : null,
    };
  }
}
