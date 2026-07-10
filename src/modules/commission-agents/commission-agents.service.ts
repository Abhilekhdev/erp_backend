import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import type { CreateCommissionAgentDto, UpdateCommissionAgentDto } from './dto/commission-agent.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }) =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();

/**
 * Sales commission agents = Users with `is_cmmsn_agnt = true`. They never log in
 * (`allow_login = false`) and are managed separately from the regular Users module — which
 * explicitly excludes them (mirrors GOURI_DEV's ManageUserController vs SalesCommissionAgentController).
 */
@Injectable()
export class CommissionAgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const search = query.search.trim();
    const where: Prisma.UserWhereInput = {
      businessId,
      isCmmsnAgnt: true,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { surname: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
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
        select: {
          id: true,
          surname: true,
          firstName: true,
          lastName: true,
          email: true,
          contactNo: true,
          address: true,
          cmmsnPercent: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data = rows.map((u) => ({
      id: u.id,
      name: fullName(u),
      email: u.email,
      contactNo: u.contactNo ?? '',
      address: u.address ?? '',
      cmmsnPercent: Number(u.cmmsnPercent),
    }));
    return { data, total };
  }

  async findOne(businessId: number, id: number) {
    const u = await this.prisma.user.findFirst({
      where: { id, businessId, isCmmsnAgnt: true, deletedAt: null },
    });
    if (!u) throw new NotFoundException('Commission agent not found');
    return {
      id: u.id,
      surname: u.surname ?? '',
      firstName: u.firstName,
      lastName: u.lastName ?? '',
      email: u.email,
      contactNo: u.contactNo ?? '',
      address: u.address ?? '',
      cmmsnPercent: Number(u.cmmsnPercent),
    };
  }

  async create(businessId: number, dto: CreateCommissionAgentDto) {
    await this.assertUniqueEmail(dto.email);
    // NOT NULL password column; agents never log in, so store an unguessable random hash.
    const passwordHash = await this.passwords.hash(randomBytes(24).toString('base64'));

    const created = await this.prisma.user.create({
      data: {
        businessId,
        userType: 'USER',
        surname: blank(dto.surname),
        firstName: dto.firstName,
        lastName: blank(dto.lastName),
        email: dto.email,
        contactNo: blank(dto.contactNo),
        address: blank(dto.address),
        cmmsnPercent: dto.cmmsnPercent ?? 0,
        isCmmsnAgnt: true,
        allowLogin: false,
        username: null,
        passwordHash,
        status: 'ACTIVE',
        language: 'en',
      },
    });
    return this.findOne(businessId, created.id);
  }

  async update(businessId: number, id: number, dto: UpdateCommissionAgentDto) {
    const agent = await this.prisma.user.findFirst({
      where: { id, businessId, isCmmsnAgnt: true, deletedAt: null },
    });
    if (!agent) throw new NotFoundException('Commission agent not found');
    if (dto.email && dto.email !== agent.email) await this.assertUniqueEmail(dto.email, id);

    // Partial PATCH: only touch what the caller sent.
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (dto.surname !== undefined) data.surname = blank(dto.surname);
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = blank(dto.lastName);
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.contactNo !== undefined) data.contactNo = blank(dto.contactNo);
    if (dto.address !== undefined) data.address = blank(dto.address);
    if (dto.cmmsnPercent !== undefined) data.cmmsnPercent = dto.cmmsnPercent;

    await this.prisma.user.update({ where: { id }, data });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    const agent = await this.prisma.user.findFirst({
      where: { id, businessId, isCmmsnAgnt: true, deletedAt: null },
    });
    if (!agent) throw new NotFoundException('Commission agent not found');
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  private async assertUniqueEmail(email: string, exceptId?: number): Promise<void> {
    const found = await this.prisma.user.findFirst({
      where: { email, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (found) throw new ConflictException('A user with this email already exists');
  }
}
