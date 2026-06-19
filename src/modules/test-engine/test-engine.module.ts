import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { BrowserModule } from '../browser/browser.module';
import { ConfigRulesModule } from '../config-rules/config-rules.module';
import { FlowStepModule } from '../flow-step/flow-step.module';
import { HealerModule } from '../healer/healer.module';
import { ReportsModule } from '../reports/reports.module';
import { TestEngineService } from './test-engine.service';

@Module({
  imports: [
    ConfigRulesModule,
    FlowStepModule,
    BrowserModule,
    HealerModule,
    AgentModule,
    ReportsModule,
  ],
  providers: [TestEngineService],
  exports: [TestEngineService],
})
export class TestEngineModule {}
