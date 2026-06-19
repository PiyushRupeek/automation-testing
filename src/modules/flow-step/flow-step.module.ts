import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ConfigRulesModule } from '../config-rules/config-rules.module';
import { HealerModule } from '../healer/healer.module';
import { OtpModule } from '../otp/otp.module';
import { FlowStepService } from './flow-step.service';

@Module({
  imports: [AgentModule, HealerModule, ConfigRulesModule, OtpModule],
  providers: [FlowStepService],
  exports: [FlowStepService],
})
export class FlowStepModule {}
