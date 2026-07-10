import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveSalesTargetsDto } from './dto/sales-target.dto';

const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();

@Injectable()
export class SalesTargetsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(businessId: number, query: { page: number; pageSize: number; search: string }) {
    const s = query.search.trim();
    const where: Prisma.UserWhereInput = {
      businessId,
      userType: 'USER',
      deletedAt: null,
      isCmmsnAgnt: false,
      allowLogin: true,
      ...(s
        ? {
            OR: [
              { firstName: { contains: s, mode: 'insensitive' } },
              { lastName: { contains: s, mode: 'insensitive' } },
              { email: { contains: s, mode: 'insensitive' } },
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
          _count: { select: { salesTargets: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data: rows.map((u) => ({ id: u.id, name: fullName(u), targetCount: u._count.salesTargets })),
      total,
    };
  }

  async getUserTargets(businessId: number, userId: number) {
    const targets = await this.prisma.essentialsUserSalesTarget.findMany({
      where: { businessId, userId },
      orderBy: { targetStart: 'asc' },
    });
    return targets.map((t) => ({
      id: t.id,
      targetStart: Number(t.targetStart),
      targetEnd: Number(t.targetEnd),
      commissionPercent: Number(t.commissionPercent),
    }));
  }

  async saveUserTargets(businessId: number, userId: number, dto: SaveSalesTargetsDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, businessId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');
    // GOURI skips rows where both start & end are empty (0).
    const bands = dto.bands.filter((b) => !(b.targetStart === 0 && b.targetEnd === 0));
    await this.prisma.$transaction(async (tx) => {
      await tx.essentialsUserSalesTarget.deleteMany({ where: { businessId, userId } });
      if (bands.length) {
        await tx.essentialsUserSalesTarget.createMany({
          data: bands.map((b) => ({
            businessId,
            userId,
            targetStart: b.targetStart,
            targetEnd: b.targetEnd,
            commissionPercent: b.commissionPercent,
          })),
        });
      }
    });
    return this.getUserTargets(businessId, userId);
  }
}
