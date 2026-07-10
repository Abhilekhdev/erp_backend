import { Module } from '@nestjs/common';
import { BusinessLocationsController } from './business-locations.controller';
import { BusinessLocationsService } from './business-locations.service';

@Module({
  controllers: [BusinessLocationsController],
  providers: [BusinessLocationsService],
})
export class BusinessLocationsModule {}
