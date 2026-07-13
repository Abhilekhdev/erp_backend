import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AbilityService } from '../services/ability.service';
import type { AccessPayload } from '../../modules/auth/token.service';

/**
 * Enforces @RequirePermissions. Mirrors Laravel's `Gate::before`: a tenant Admin
 * (`isBusinessAdmin`) passes every check; everyone else must hold at least one of the
 * required permissions (resolved from their roles + direct grants).
 *
 * On top of enforcement, it stamps the resolved permission set onto `request.user.permissions`
 * so downstream services can make fine-grained "all vs own" decisions without re-querying.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ability: AbilityService,
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

    const perms = await this.ability.loadPermissions(user.sub);
    user.permissions = [...perms]; // stamp for downstream services (fine-grained scoping)
    if (!required.some((p) => perms.has(p))) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
