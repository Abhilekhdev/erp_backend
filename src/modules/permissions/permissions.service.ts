import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PERMISSION_CATALOG, type PermGroup } from './permissions.catalog';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Add-on modules (the `Modules/` packages in GOURI_DEV: Essentials/HRM, Manufacturing,
   * DocumentSign). Laravel gates these via `ModuleUtil::hasThePermissionInSubscription()`, which
   * returns `true` whenever the Superadmin/subscription module is NOT installed, and they are never
   * stored in the business `enabled_modules` array. This stack has no subscription system, so —
   * exactly like legacy — they are always available. See [[data-model-conventions]].
   */
  private static readonly ADDON_MODULES = new Set(['essentials', 'manufacturing', 'documentsign']);

  /**
   * The permission catalogue filtered to what THIS business can actually use. Groups tied to a
   * disabled core module are dropped — mirroring the `@if (in_array(..., $enabled_modules))` guards
   * in the Laravel role form. Add-on modules (see ADDON_MODULES) are always kept. Setting-gated
   * groups (purchase order/requisition, sales order) are off by default and not yet modeled, so
   * they stay hidden like a fresh Laravel business until the business-settings module wires them.
   */
  async getCatalog(businessId: number): Promise<PermGroup[]> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { enabledModules: true },
    });

    const modules = Array.isArray(business?.enabledModules)
      ? (business!.enabledModules as string[])
      : [];

    return PERMISSION_CATALOG.filter((group) => {
      if (group.module) {
        // Add-on modules aren't part of enabled_modules; always on (no subscription gating).
        if (PermissionsService.ADDON_MODULES.has(group.module)) return true;
        // Laravel shows the Purchases block when EITHER purchases or stock_adjustment is enabled.
        if (group.module === 'purchases') {
          return modules.includes('purchases') || modules.includes('stock_adjustment');
        }
        return modules.includes(group.module);
      }
      if (group.setting) return false;
      return true;
    });
  }
}
