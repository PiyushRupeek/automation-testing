import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ConfigRulesModule } from '../config-rules/config-rules.module';
import { HealerModule } from '../healer/healer.module';
import { ExplorerService } from './explorer.service';
import { ExplorerController } from './explorer.controller';
import { StagehandBrowserAdapter } from './stagehand-browser.adapter';
import { ScreenAnalyzerService } from './screen-analyzer.service';
import { FlowGeneratorService } from './flow-generator.service';
import { TemplateResolverService } from './template-resolver.service';
import { DiffMergeService } from './diff-merge.service';

@Module({
  imports: [AgentModule, ConfigRulesModule, HealerModule],
  providers: [
    ExplorerService,
    StagehandBrowserAdapter,
    ScreenAnalyzerService,
    FlowGeneratorService,
    TemplateResolverService,
    DiffMergeService,
  ],
  controllers: [ExplorerController],
  exports: [ExplorerService],
})
export class ExplorerModule {}
