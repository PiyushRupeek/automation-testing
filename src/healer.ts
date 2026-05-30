import * as fs from 'fs';
import * as path from 'path';
import { FlowVariant, HealAttemptLog, HealLog, ConfigPatch, ConfigPatchRecord, TestRules } from './types';

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const BACKUPS_DIR = path.join(process.cwd(), 'config', 'backups');

const MAX_PATCHES_PER_RUN = 5;
const MAX_PATCHES_PER_STEP = 1;

export function isAutoHealEnabled(): boolean {
  if (process.argv.includes('--no-auto-heal')) return false;
  return process.env.AUTO_HEAL !== 'false';
}

export function getMaxHealAttempts(): number {
  const raw = process.env.AUTO_HEAL_MAX_ATTEMPTS;
  const n = raw ? parseInt(raw, 10) : 3;
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export class HealSession {
  readonly runId: string;
  readonly configPath: string;
  readonly variant: FlowVariant;
  readonly attempts: HealAttemptLog[] = [];
  readonly configPatches: ConfigPatchRecord[] = [];
  private readonly patchesPerStep = new Map<number, number>();

  constructor(runId: string, configPath: string, variant: FlowVariant) {
    this.runId = runId;
    this.configPath = configPath;
    this.variant = variant;
  }

  canPatchStep(stepNumber: number): boolean {
    if (this.configPatches.length >= MAX_PATCHES_PER_RUN) return false;
    return (this.patchesPerStep.get(stepNumber) ?? 0) < MAX_PATCHES_PER_STEP;
  }

  recordAttempt(entry: HealAttemptLog): void {
    this.attempts.push(entry);
  }

  recordPatch(record: ConfigPatchRecord): void {
    this.configPatches.push(record);
    this.patchesPerStep.set(record.step, (this.patchesPerStep.get(record.step) ?? 0) + 1);
  }

  toHealLog(): HealLog {
    return {
      runId: this.runId,
      attempts: this.attempts,
      configPatches: this.configPatches,
    };
  }

  writeHealLog(): string {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    const logPath = path.join(REPORTS_DIR, `heal-log-${this.runId}.json`);
    fs.writeFileSync(logPath, JSON.stringify(this.toHealLog(), null, 2), 'utf-8');
    return logPath;
  }
}

export function backupConfig(configPath: string, variant: FlowVariant): string {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUPS_DIR, `${variant}-${stamp}.config.json`);
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

export function applyFlowStepPatch(rules: TestRules, stepNumber: number, patch: ConfigPatch): TestRules {
  const cloned = JSON.parse(JSON.stringify(rules)) as TestRules;
  const step = cloned.flow.find((s) => s.step === stepNumber);
  if (!step) {
    throw new Error(`Step ${stepNumber} not found for config patch`);
  }

  if (patch.removeActionIndexes?.length) {
    const remove = new Set(patch.removeActionIndexes);
    step.actions = step.actions.filter((_, idx) => !remove.has(idx));
  }
  if (patch.replaceActions) {
    step.actions = patch.replaceActions;
  }
  if (patch.replaceAssertions) {
    step.assertions = patch.replaceAssertions;
  }
  if (patch.addNotes) {
    step.notes = step.notes ? `${step.notes} | ${patch.addNotes}` : patch.addNotes;
  }

  return cloned;
}

export function persistFlowStepPatch(
  configPath: string,
  stepNumber: number,
  patch: ConfigPatch
): void {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as TestRules;
  const updated = applyFlowStepPatch(parsed, stepNumber, patch);
  fs.writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
}

export function isPatchSafe(patch: ConfigPatch): boolean {
  const serialized = JSON.stringify(patch);
  const forbidden = ['credentials', 'notifications', '{{env.', 'ANTHROPIC'];
  return !forbidden.some((token) => serialized.includes(token));
}
