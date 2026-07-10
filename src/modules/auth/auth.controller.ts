import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService, type AuthUserDto, type UserWithAuth } from './auth.service';
import { TokenService, type AccessPayload } from './token.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

interface SessionResponse {
  accessToken: string;
  user: AuthUserDto;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Get('currencies')
  currencies() {
    return this.prisma.currency.findMany({
      orderBy: { currency: 'asc' },
      select: { id: true, country: true, currency: true, code: true, symbol: true },
    });
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const user = await this.auth.register(dto);
    return this.issueSession(user, req, res);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const user = await this.auth.validateLogin(dto.email, dto.password);
    return this.issueSession(user, req, res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const raw = req.cookies?.[this.cookieName];
    if (!raw) throw new UnauthorizedException('No active session');
    const { userId, refreshToken } = await this.tokens.rotateRefreshToken(raw, this.meta(req));
    const user = await this.auth.loadUser(userId);
    this.setRefreshCookie(res, refreshToken);
    return {
      accessToken: this.tokens.signAccessToken(this.auth.accessPayload(user)),
      user: this.auth.buildAuthUser(user),
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[this.cookieName];
    if (raw) await this.tokens.revoke(raw);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() payload: AccessPayload): Promise<AuthUserDto> {
    const user = await this.auth.loadUser(payload.sub);
    return this.auth.buildAuthUser(user);
  }

  // ── helpers ──────────────────────────────────────────
  private get cookieName(): string {
    return this.config.get('REFRESH_COOKIE_NAME', { infer: true });
  }

  private meta(req: Request) {
    return { userAgent: req.get('user-agent') ?? undefined, ipAddress: req.ip };
  }

  private async issueSession(
    user: UserWithAuth,
    req: Request,
    res: Response,
  ): Promise<SessionResponse> {
    const refreshToken = await this.tokens.issueRefreshToken(user.id, this.meta(req));
    this.setRefreshCookie(res, refreshToken);
    return {
      accessToken: this.tokens.signAccessToken(this.auth.accessPayload(user)),
      user: this.auth.buildAuthUser(user),
    };
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: this.config.get('JWT_REFRESH_TTL', { infer: true }) * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(this.cookieName, { path: '/api/auth' });
  }
}
