import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
}
