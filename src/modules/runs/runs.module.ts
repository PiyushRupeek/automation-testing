import { Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module';
import { TestEngineModule } from '../test-engine/test-engine.module';
import { RunManagerService } from './run-manager.service';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [TestEngineModule, OtpModule],
  controllers: [RunsController],
  providers: [RunManagerService, RunsService],
  exports: [RunManagerService, RunsService],
})
export class RunsModule {}
