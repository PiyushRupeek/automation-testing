import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { FlowVariant, RunMode } from '../../../common/types';

export class StartRunDto {
  @IsIn(['fresh', 'takeover', 'state-management'])
  variant!: FlowVariant;

  @IsOptional()
  @IsIn(['happy', 'errors', 'all', 'scenarios'])
  mode?: RunMode;

  @IsOptional()
  @IsBoolean()
  autoHeal?: boolean;
}

export interface RunTestSuiteOptions {
  runId?: string;
  variant: FlowVariant;
  mode: RunMode;
  autoHeal?: boolean;
  argv?: string[];
  onProgress?: (event: {
    type: 'run_started' | 'step_started' | 'step_completed';
    step?: number;
    stepName?: string;
    status?: string;
    error?: string;
  }) => void;
}
