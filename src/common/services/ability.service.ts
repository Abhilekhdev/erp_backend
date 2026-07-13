import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../../modules/auth/token.service';

/**
 * Central authorization helper — the single place that resolves and checks a user's permissions.
 *
 * Mirrors Laravel's `Gate::before`: a tenant Admin (`isBusinessAdmin`) passes every check. Everyone
 * else is checked against their resolved permission set (roles + direct grants). The set is loaded
 * once per request by the PermissionsGuard and stamped onto `user.permissions`, so `can()` is a
 * cheap in-memory check on guarded routes and only falls back to a DB load if that stamp is absent.
 */
@Injectable()
export class AbilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full permission set for a user (role permissions ∪ direct user grants). */
  async loadPermissions(userId: number): Promise<Set<string>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        permissions: { include: { permission: true } },
      },
    });
    const set = new Set<string>();
    user?.roles.forEach((r) => r.role.permissions.forEach((rp) => set.add(rp.permission.name)));
    user?.permissions.forEach((up) => set.add(up.permission.name));
    return set;
  }

  /** Resolve the permission set, preferring the guard-stamped list to avoid a DB round-trip. */
  private async resolve(user: AccessPayload): Promise<Set<string>> {
    if (user.permissions) return new Set(user.permissions);
    return this.loadPermissions(user.sub);
  }

  /** True if the user holds `permission` (admins always pass). */
  async can(user: AccessPayload, permission: string): Promise<boolean> {
    if (user.isBusinessAdmin) return true;
    if (user.permissions) return user.permissions.includes(permission);
    return (await this.loadPermissions(user.sub)).has(permission);
  }

  /** True if the user holds ANY of `permissions` (admins always pass). */
  async canAny(user: AccessPayload, permissions: string[]): Promise<boolean> {
    if (user.isBusinessAdmin) return true;
    const set = await this.resolve(user);
    return permissions.some((p) => set.has(p));
  }
}
