import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { UpdateHrmSettingsDto } from './dto/hrm-settings.dto';
import { HrmSettingsService } from './hrm-settings.service';

@Controller('hrm/settings')
@UseGuards(PermissionsGuard)
export class HrmSettingsController {
  constructor(private readonly settings: HrmSettingsService) {}

  @Get()
  @RequirePermissions('edit_essentials_settings')
  get(@CurrentUser() user: AccessPayload) {
    return this.settings.get(user.businessId as number);
  }

  @Put()
  @RequirePermissions('edit_essentials_settings')
  update(@CurrentUser() user: AccessPayload, @Body() dto: UpdateHrmSettingsDto) {
    return this.settings.update(user.businessId as number, dto);
  }
}
