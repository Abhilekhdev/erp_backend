import { Module } from '@nestjs/common';
import { WastageTypesController } from './wastage-types.controller';
import { WastageTypesService } from './wastage-types.service';

@Module({
  controllers: [WastageTypesController],
  providers: [WastageTypesService],
})
export class WastageTypesModule {}
