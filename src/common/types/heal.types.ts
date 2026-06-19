import { TestAction, TestAssertion } from './test.types';

export type RecoveryType =
  | 'retry'
  | 'skip_action'
  | 'wait_then_retry'
  | 'patch_config'
  | 'abort';

export interface ConfigPatch {
  removeActionIndexes?: number[];
  replaceActions?: TestAction[];
  replaceAssertions?: TestAssertion[];
  addNotes?: string;
}

export interface RecoveryPlan {
  type: RecoveryType;
  reason: string;
  confidence?: 'high' | 'medium' | 'low';
  selector?: string;
  action?: TestAction['type'];
  value?: string;
  waitMs?: number;
  patch?: ConfigPatch;
}

export interface HealAttemptLog {
  step: number;
  stepName: string;
  context: 'action' | 'assertion';
  actionIndex?: number;
  assertionIndex?: number;
  error: string;
  recovery: RecoveryPlan;
  outcome: 'recovered' | 'failed' | 'patched';
  timestamp: string;
}

export interface ConfigPatchRecord {
  step: number;
  backupPath: string;
  patch: ConfigPatch;
  reason: string;
}

export interface HealLog {
  runId: string;
  attempts: HealAttemptLog[];
  configPatches: ConfigPatchRecord[];
}
