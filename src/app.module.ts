import { Module } from '@nestjs/common';
import { AppConfigModule } from './common/config/config.module';
import { OtpModule } from './modules/otp/otp.module';
import { RunsModule } from './modules/runs/runs.module';
import { TestEngineModule } from './modules/test-engine/test-engine.module';

@Module({
  imports: [AppConfigModule, TestEngineModule, RunsModule, OtpModule],
})
export class AppModule {}
