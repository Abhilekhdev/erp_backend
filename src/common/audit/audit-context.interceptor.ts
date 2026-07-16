import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import type { AccessPayload } from '../../modules/auth/token.service';
import { AUDIT_CTX_KEY, type AuditContext } from './audit.types';

/**
 * The bridge between the request and the Prisma layer.
 *
 * A Prisma middleware has no idea who is calling — it only sees `product.update(...)`. The JWT
 * already carries everything we need (`sub`, `businessId`), so we lift it into CLS once per request
 * and the trail gets its causer for free: no extra query, no threading a userId through every
 * service signature.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() === 'http' && this.cls.isActive()) {
      const req = context.switchToHttp().getRequest<Request & { user?: AccessPayload }>();
      const ctx: AuditContext = {
        userId: req.user?.sub,
        businessId: req.user?.businessId ?? null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
        route: `${req.method} ${req.originalUrl.split('?')[0]}`,
      };
      this.cls.set(AUDIT_CTX_KEY, ctx);
    }
    return next.handle();
  }
}
