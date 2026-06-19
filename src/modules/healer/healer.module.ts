import { Module } from '@nestjs/common';
import { HealerService } from './healer.service';

@Module({
  providers: [HealerService],
  exports: [HealerService],
})
export class HealerModule {}
