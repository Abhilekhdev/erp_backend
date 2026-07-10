import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { SaveNotificationTemplatesDto } from './dto/save-notification-templates.dto';
import { NotificationTemplatesService } from './notification-templates.service';

@Controller('notification-templates')
@UseGuards(PermissionsGuard)
export class NotificationTemplatesController {
  constructor(private readonly templates: NotificationTemplatesService) {}

  @Get()
  @RequirePermissions('send_notification')
  index(@CurrentUser() user: AccessPayload) {
    return this.templates.getTemplates(user.businessId as number);
  }

  @Post()
  @RequirePermissions('send_notification')
  @HttpCode(200)
  save(@CurrentUser() user: AccessPayload, @Body() dto: SaveNotificationTemplatesDto) {
    return this.templates.saveTemplates(user.businessId as number, dto);
  }
}
