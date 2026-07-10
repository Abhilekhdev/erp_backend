import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { CommissionAgentsController } from './commission-agents.controller';
import { CommissionAgentsService } from './commission-agents.service';

@Module({
  controllers: [CommissionAgentsController],
  providers: [CommissionAgentsService, PasswordService],
})
export class CommissionAgentsModule {}
