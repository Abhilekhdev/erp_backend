import { Module } from '@nestjs/common';
import { SellsController } from './sells.controller';
import { SellsMetaService } from './sells-meta.service';
import { SellsService } from './sells.service';

@Module({
  controllers: [SellsController],
  providers: [SellsService, SellsMetaService],
  exports: [SellsService],
})
export class SellsModule {}
