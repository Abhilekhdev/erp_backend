import { Module } from '@nestjs/common';
import { BusinessSettingsController } from './business-settings.controller';
import { BusinessSettingsService } from './business-settings.service';

@Module({
  controllers: [BusinessSettingsController],
  providers: [BusinessSettingsService],
})
export class BusinessSettingsModule {}
