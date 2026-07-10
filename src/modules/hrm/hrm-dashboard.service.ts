import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class HrmDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HR dashboard summary (mirrors GOURI's hrm_dashboard). Only the pieces whose modules exist are
   * populated today — user headcount + per-department counts; leaves/attendance/targets/payroll
   * arrive with their sub-modules and the UI shows empty states until then.
   */
  async getDashboard(businessId: number) {
    const userWhere: Prisma.UserWhereInput = {
      businessId,
      userType: 'USER',
      deletedAt: null,
      isCmmsnAgnt: false,
    };

    const [userCount, departments, grouped] = await Promise.all([
      this.prisma.user.count({ where: userWhere }),
      this.prisma.department.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.groupBy({
        by: ['essentialsDepartmentId'],
        where: { ...userWhere, essentialsDepartmentId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const countMap = new Map(grouped.map((g) => [g.essentialsDepartmentId, g._count._all]));
    return {
      userCount,
      departments: departments.map((d) => ({
        id: d.id,
        name: d.name,
        userCount: countMap.get(d.id) ?? 0,
      })),
    };
  }
}
