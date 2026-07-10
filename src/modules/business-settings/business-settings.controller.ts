import {
  Body,
  Controller,
  Get,
  Put,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { BusinessSettingsService, type UploadedImage } from './business-settings.service';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';

@Controller('business/settings')
@UseGuards(PermissionsGuard)
export class BusinessSettingsController {
  constructor(private readonly settings: BusinessSettingsService) {}

  @Get()
  @RequirePermissions('business_settings.access')
  get(@CurrentUser() user: AccessPayload) {
    return this.settings.getSettings(user.businessId as number);
  }

  @Put()
  @RequirePermissions('business_settings.access')
  update(@CurrentUser() user: AccessPayload, @Body() dto: UpdateBusinessSettingsDto) {
    return this.settings.updateSettings(user.businessId as number, dto);
  }

  @Post('logo')
  @RequirePermissions('business_settings.access')
  @UseInterceptors(FileInterceptor('file'))
  uploadLogo(
    @CurrentUser() user: AccessPayload,
    @Body('type') type: 'logo' | 'login_logo',
    @UploadedFile() file: UploadedImage,
  ) {
    return this.settings.uploadLogo(user.businessId as number, type, file);
  }
}
