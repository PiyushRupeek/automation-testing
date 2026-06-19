import { HealLog } from './heal.types';
import { StepResult } from './test.types';

export interface RunResult {
  runId: string;
  timestamp: string;
  site: string;
  totalSteps: number;
  passed: number;
  failed: number;
  steps: StepResult[];
  duration: number;
  summary?: string;
  apiCostEstimate?: number;
  healLog?: HealLog;
}

export type RunJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface RunProgressEvent {
  type: 'run_started' | 'step_started' | 'step_completed' | 'run_completed' | 'run_failed' | 'heartbeat';
  runId: string;
  timestamp: string;
  step?: number;
  stepName?: string;
  status?: string;
  error?: string;
  result?: RunResult;
}
