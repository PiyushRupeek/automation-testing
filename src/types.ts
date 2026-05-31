export type ActionType = 'fill' | 'click' | 'select' | 'upload' | 'check' | 'uncheck' | 'assert_text';

export type AssertionType =
  | 'url_contains'
  | 'element_visible'
  | 'text_matches'
  | 'no_error_toast';

export interface SiteConfig {
  baseUrl: string;
  name: string;
  timeout: number;
}

export interface Credentials {
  mobile: string;
  otp: string;
  pan: string;
}

export type FlowVariant = 'fresh' | 'takeover';

export interface LoanDetails {
  amount: number;
  goldWeight: number;
  purity: string;
  purpose: string;
  pincode?: string;
}

export interface TestAction {
  type: ActionType;
  label: string;
  value?: string;
  file?: string;
  pattern?: string;
}

export interface TestAssertion {
  type: AssertionType;
  value?: string;
  label?: string;
  pattern?: string;
}

export interface FlowStep {
  step: number;
  name: string;
  url?: string;
  actions: TestAction[];
  assertions: TestAssertion[];
  notes?: string;
}

export interface ErrorCaseOverride {
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface ErrorCase {
  name: string;
  step: number;
  override: ErrorCaseOverride;
  expectedError: string;
}

export interface Notifications {
  slackWebhook: string;
  email: string;
}

export interface TestRules {
  flowVariant?: FlowVariant;
  site: SiteConfig;
  credentials: Credentials;
  loanDetails: LoanDetails;
  flow: FlowStep[];
  errorCases: ErrorCase[];
  schedule: string;
  notifications: Notifications;
}

export interface PlanStepResult {
  selector: string;
  action: ActionType;
  value?: string;
}

export interface AssertionResult {
  pass: boolean;
  reason: string;
}

export interface ActionLog {
  label: string;
  type: ActionType;
  selector?: string;
  status: 'pass' | 'fail';
  error?: string;
  screenshot?: string;
}

export interface AssertionLog {
  type: AssertionType;
  label?: string;
  value?: string;
  pass: boolean;
  reason: string;
}

export type StepStatus = 'pass' | 'fail' | 'skip';

export interface StepResult {
  step: number;
  name: string;
  status: StepStatus;
  screenshot?: string;
  error?: string;
  duration: number;
  actions: ActionLog[];
  assertions: AssertionLog[];
}

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
  action?: ActionType;
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

export interface PlanStepContext {
  priorError?: string;
  failedSelector?: string;
  avoidSelectors?: string[];
}

export interface FailureContext {
  step: FlowStep;
  context: 'action' | 'assertion';
  action?: TestAction;
  actionIndex?: number;
  assertion?: TestAssertion;
  assertionIndex?: number;
  error: string;
  failedSelector?: string;
  pageHTML: string;
  currentUrl: string;
  screenshotBase64?: string;
}

export type RunMode = 'happy' | 'errors' | 'all';

export interface StepRunOptions {
  uploadFileOverride?: string;
  skipConsent?: boolean;
  clearCookiesBefore?: string[];
  useEmergencySlot?: boolean;
  timeout?: number;
}

export interface ResolvedAction extends TestAction {
  resolvedValue?: string;
  resolvedFile?: string;
}

export interface ExecuteActionInput {
  selector: string;
  action: ActionType;
  value?: string;
  file?: string;
  label?: string;
}
