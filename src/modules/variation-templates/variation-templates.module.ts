import { Module } from '@nestjs/common';
import { VariationTemplatesController } from './variation-templates.controller';
import { VariationTemplatesService } from './variation-templates.service';

@Module({
  controllers: [VariationTemplatesController],
  providers: [VariationTemplatesService],
  exports: [VariationTemplatesService],
})
export class VariationTemplatesModule {}
