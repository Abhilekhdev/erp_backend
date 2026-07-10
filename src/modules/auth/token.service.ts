import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface AccessPayload {
  sub: number;
  businessId: number | null;
  userType: string;
  isBusinessAdmin: boolean;
  roles: string[];
}

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  signAccessToken(payload: AccessPayload): string {
    return this.jwt.sign(payload);
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Create a new opaque refresh token (raw returned to caller, only its hash is stored). */
  async issueRefreshToken(userId: number, meta: SessionMeta = {}, familyId?: string): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const ttl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: familyId ?? randomUUID(),
        tokenHash: this.sha256(raw),
        expiresAt: new Date(Date.now() + ttl * 1000),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });
    return raw;
  }

  /**
   * Rotate a refresh token: the presented token is revoked and a fresh one issued in the same
   * family. Presenting an already-revoked token = theft → the whole family is revoked.
   */
  async rotateRefreshToken(
    rawToken: string,
    meta: SessionMeta = {},
  ): Promise<{ userId: number; refreshToken: string }> {
    const tokenHash = this.sha256(rawToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record) throw new UnauthorizedException('Invalid session');

    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session reuse detected — please sign in again');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired');
    }

    const refreshToken = await this.issueRefreshToken(record.userId, meta, record.familyId);
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return { userId: record.userId, refreshToken };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
