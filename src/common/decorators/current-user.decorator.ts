import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessPayload } from '../../modules/auth/token.service';

/** Injects the JWT payload attached to the request by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
