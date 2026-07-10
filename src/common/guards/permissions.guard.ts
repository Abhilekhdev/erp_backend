import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { AccessPayload } from '../../modules/auth/token.service';

/**
 * Enforces @RequirePermissions. Mirrors Laravel's `Gate::before`: a tenant Admin
 * (`isBusinessAdmin`) passes every check; everyone else must hold at least one of the
 * required permissions (resolved from their roles + direct grants).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AccessPayload | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.isBusinessAdmin) return true;

    const perms = await this.loadPermissions(user.sub);
    if (!required.some((p) => perms.has(p))) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }

  private async loadPermissions(userId: number): Promise<Set<string>> {
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
}
