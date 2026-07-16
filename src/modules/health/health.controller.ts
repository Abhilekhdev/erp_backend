import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../common/services/mail.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Public()
  @Get()
  async check() {
    let db = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      services: { database: db },
    };
  }

  /**
   * Opens an SMTP connection and authenticates WITHOUT sending anything — the quickest way to
   * prove the MAIL_* env vars are right. Deliberately NOT @Public: it reveals whether mail is
   * configured and echoes provider errors, so it stays behind auth.
   */
  @Get('mail')
  async mailCheck() {
    const result = await this.mail.verify();
    return { configured: this.mail.isConfigured(), ...result };
  }
}
