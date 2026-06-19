export type ActionType =
  | 'fill'
  | 'click'
  | 'select'
  | 'upload'
  | 'check'
  | 'uncheck'
  | 'assert_text'
  | 'navigate'
  | 'reload'
  | 'clear_storage';

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
  mobile?: string;
  mobileFresh?: string;
  mobileTakeover?: string;
  otp: string;
  pan: string;
}

export type FlowVariant = 'fresh' | 'takeover' | 'state-management';

export interface LoanDetails {
  amount: number;
  goldWeight: number;
  purity: string;
  purpose: string;
  pincode?: string;
}

export interface TestAction {
  type: ActionType;
  label?: string;
  value?: string;
  file?: string;
  pattern?: string;
  target?: string;
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
  phase?: string;
  actions: TestAction[];
  assertions: TestAssertion[];
  notes?: string;
}

export interface Scenario {
  id: string;
  name: string;
  loanType: 'fresh' | 'takeover';
  description?: string;
  flow: FlowStep[];
}

export interface ErrorCaseOverride {
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface ErrorCase {
  name: string;
  step: number;
  override: ErrorCaseOverride;
  expectedError: string;
  scenario?: string;
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

export interface StateManagementRules {
  flowVariant: 'state-management';
  site: SiteConfig;
  credentials: Credentials;
  loanDetails: LoanDetails;
  scenarios: Scenario[];
  errorCases: ErrorCase[];
  schedule: string;
  notifications: Notifications;
}

export type RulesConfig = TestRules | StateManagementRules;

export function isStateManagementRules(rules: RulesConfig): rules is StateManagementRules {
  return rules.flowVariant === 'state-management' || 'scenarios' in rules;
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
  label?: string;
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

export type RunMode = 'happy' | 'errors' | 'all' | 'scenarios';

export interface StepRunOptions {
  uploadFileOverride?: string;
  skipConsent?: boolean;
  clearCookiesBefore?: string[];
  useEmergencySlot?: boolean;
  timeout?: number;
  artifactPrefix?: string;
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
