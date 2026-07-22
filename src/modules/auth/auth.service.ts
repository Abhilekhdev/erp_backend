import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OWNER_ROLE } from '../../common/constants/roles';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PasswordService } from './password.service';
import type { AccessPayload } from './token.service';
import type { RegisterDto } from './dto/register.dto';

export const userInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  permissions: { include: { permission: true } },
  // The currency comes along so the whole UI can render the tenant's symbol (₹ / $ / …) without
  // every screen fetching business settings.
  business: { include: { currency: true } },
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
  business: {
    id: number;
    name: string;
    logo: string | null;
    /** Tenant currency — drives every money symbol in the UI. */
    currencySymbol: string;
    currencyCode: string;
    currencySymbolPlacement: string;
    currencyPrecision: number;
  } | null;
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

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);

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
          // The day they signed up. Not asked for — it is only a reporting boundary, and Settings →
          // Business can move it if the real trading history started earlier.
          startDate: new Date(),
          timeZone: dto.timeZone || 'Asia/Kolkata',
          // fyStartMonth, accountingMethod, tax labels/numbers and the logo all keep their schema
          // defaults and are set from Business Settings — see the DTO for why they are not asked here.
          // Laravel createNewBusiness defaults: inline tax OFF, 25% default profit.
          enableInlineTax: false,
          defaultProfitPercent: 25,
          enabledModules: DEFAULT_ENABLED_MODULES,
          isActive: true,
          createdBy: owner.id,
        },
      });

      await tx.user.update({ where: { id: owner.id }, data: { businessId: business.id } });

      // The owner's Super Admin role = the Gate::before wildcard. No explicit permissions attached.
      const ownerRole = await tx.role.create({
        data: { name: OWNER_ROLE, businessId: business.id, isDefault: true },
      });
      await tx.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id } });

      // Everything below is what GOURI's `newBusinessDefaultResources` + `addLocation` set up, so a
      // brand-new tenant can sell on day one instead of hitting "no location" errors everywhere.
      const scheme = await tx.invoiceScheme.create({
        data: {
          businessId: business.id,
          name: 'Default',
          prefix: '',
          startNumber: 1,
          totalDigits: 4,
          isDefault: true,
          createdAt: new Date(),
        },
      });

      // The first location. GOURI names it after the business and never asks for the address
      // separately — same here, but the address is optional so signup stays short.
      const location = await tx.businessLocation.create({
        data: {
          businessId: business.id,
          name: dto.businessName,
          locationId: 'BL0001',
          country: dto.country || '-',
          state: dto.state || '-',
          city: dto.city || '-',
          zipCode: dto.zipCode || '-',
          landmark: blank(dto.landmark),
          mobile: blank(dto.mobile),
          alternateNumber: blank(dto.alternateNumber),
          website: blank(dto.website),
          invoiceSchemeId: scheme.id,
          // No invoice layouts module yet — 0 is the documented placeholder used elsewhere.
          invoiceLayoutId: 0,
          isActive: true,
        },
      });
      await tx.referenceCount.create({
        data: { businessId: business.id, refType: 'business_location', refCount: 1 },
      });
      // GOURI mints a per-location permission on create; keep it so location-scoped access works.
      await tx.permission.upsert({
        where: { name: `location.${location.id}` },
        update: {},
        create: { name: `location.${location.id}`, resource: 'location', action: String(location.id) },
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
      isBusinessAdmin: roles.includes(OWNER_ROLE),
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
      isBusinessAdmin: roles.includes(OWNER_ROLE),
      roles,
      permissions: Array.from(new Set([...rolePerms, ...directPerms])),
      business: user.business
        ? {
            id: user.business.id,
            name: user.business.name,
            logo: user.business.logo,
            currencySymbol: user.business.currency?.symbol ?? '',
            currencyCode: user.business.currency?.code ?? '',
            currencySymbolPlacement: user.business.currencySymbolPlacement.toLowerCase(),
            currencyPrecision: user.business.currencyPrecision,
          }
        : null,
    };
  }
}
