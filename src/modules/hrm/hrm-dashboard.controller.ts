import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessPayload } from '../auth/token.service';
import { HrmDashboardService } from './hrm-dashboard.service';

@Controller('hrm/dashboard')
export class HrmDashboardController {
  constructor(private readonly dashboard: HrmDashboardService) {}

  // Any authenticated HRM user can see the dashboard (matches GOURI — no specific permission).
  @Get()
  get(@CurrentUser() user: AccessPayload) {
    return this.dashboard.getDashboard(user.businessId as number);
  }
}
