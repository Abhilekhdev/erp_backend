import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { UpdateHrmSettingsDto } from './dto/hrm-settings.dto';

const num = (v: unknown): string => (v == null || v === '' ? '' : String(v));

@Injectable()
export class HrmSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async raw(businessId: number): Promise<Record<string, unknown>> {
    const b = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { essentialsSettings: true },
    });
    return (b?.essentialsSettings as Record<string, unknown>) ?? {};
  }

  async get(businessId: number) {
    const s = await this.raw(businessId);
    return {
      leaveRefNoPrefix: (s.leave_ref_no_prefix as string) ?? '',
      leaveInstructions: (s.leave_instructions as string) ?? '',
      payrollRefNoPrefix: (s.payroll_ref_no_prefix as string) ?? '',
      isLocationRequired: Boolean(Number(s.is_location_required ?? 0)),
      graceBeforeCheckin: num(s.grace_before_checkin),
      graceAfterCheckin: num(s.grace_after_checkin),
      graceBeforeCheckout: num(s.grace_before_checkout),
      graceAfterCheckout: num(s.grace_after_checkout),
      calculateSalesTargetCommissionWithoutTax: Boolean(
        Number(s.calculate_sales_target_commission_without_tax ?? 0),
      ),
      essentialsTodosPrefix: (s.essentials_todos_prefix as string) ?? '',
    };
  }

  async update(businessId: number, dto: UpdateHrmSettingsDto) {
    const existing = await this.raw(businessId);
    const settings = {
      ...existing,
      leave_ref_no_prefix: dto.leaveRefNoPrefix || null,
      leave_instructions: dto.leaveInstructions || null,
      payroll_ref_no_prefix: dto.payrollRefNoPrefix || null,
      is_location_required: dto.isLocationRequired ? 1 : 0,
      grace_before_checkin: dto.graceBeforeCheckin ?? null,
      grace_after_checkin: dto.graceAfterCheckin ?? null,
      grace_before_checkout: dto.graceBeforeCheckout ?? null,
      grace_after_checkout: dto.graceAfterCheckout ?? null,
      calculate_sales_target_commission_without_tax: dto.calculateSalesTargetCommissionWithoutTax ? 1 : 0,
      essentials_todos_prefix: dto.essentialsTodosPrefix || null,
    };
    await this.prisma.business.update({
      where: { id: businessId },
      data: { essentialsSettings: settings as Prisma.InputJsonValue },
    });
    return this.get(businessId);
  }
}
