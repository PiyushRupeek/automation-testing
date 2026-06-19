import { Module } from '@nestjs/common';
import { ConfigRulesService } from './config-rules.service';

@Module({
  providers: [ConfigRulesService],
  exports: [ConfigRulesService],
})
export class ConfigRulesModule {}
