import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import {
  AssertionResult,
  ErrorCaseOverride,
  FlowVariant,
  PlanStepResult,
  RunResult,
  TestAction,
  TestAssertion,
  TestRules,
  FailureContext,
  PlanStepContext,
  RecoveryPlan,
} from './types';

const MODEL = 'claude-sonnet-4-20250514';

export const SPECIAL_OVERRIDE_KEYS = new Set([
  'uploadFile',
  'uncheckConsent',
  'clearCookies',
  'useEmergencySlot',
]);
const SPECIAL_TEMPLATE_PREFIXES = ['prompt.'];

const PLAN_STEP_SYSTEM = `You are a UI automation expert. Given a test step action and the current page HTML,
identify the best CSS selector for the target element.
Rules:
  1. Prefer [data-testid] attributes above all else
  2. Fall back to [aria-label], [name], [placeholder] in that order
  3. Last resort: text content selectors like button:has-text('Submit')
  4. For selectable cards/options (loan type, preference cards), target the innermost clickable card element that contains the label text — avoid outer page wrappers
  5. For fill actions, NEVER use [value="..."] selectors — values are dynamic. Use placeholder, name, type, aria-label, or input inside the labeled section
  6. Meeting slots page: date cells are in a horizontal calendar; time slots are Morning/Afternoon buttons. If targeting a time slot fails, the selected date may have no slots — target the next unselected date cell instead
  7. Return ONLY raw JSON. No markdown, no explanation.
  8. Format: { "selector": "...", "action": "click|fill|select|upload|check", "value": "..." }`;

const EVALUATE_ASSERTION_SYSTEM = `You are a UI test validator. Given an assertion definition and the current page HTML + screenshot,
determine if the assertion passes.
Rules:
  1. Return ONLY raw JSON: { "pass": true|false, "reason": "one sentence" }
  2. For url_contains: check if the provided value is a substring of the current URL
  3. For element_visible: check if an element matching the label exists and is visible
  4. For text_matches: check if element text matches the provided regex pattern
  5. For no_error_toast: check that no error/warning toast/alert is visible
  6. Be strict — only pass if clearly satisfied`;

const REPORT_SUMMARY_SYSTEM = `You are a QA report writer. Given a JSON test run result, write a concise plain-English summary
of what passed, what failed, and likely root causes. Return only the summary text, no JSON.`;

const DIAGNOSE_FAILURE_SYSTEM = `You are a self-healing UI test automation expert for Rupeek B2C LP2 gold loan booking.
Given a failed action or assertion, the page HTML, screenshot, and error, return a recovery plan as JSON.

Rules:
  1. Return ONLY raw JSON: { "type": "retry|skip_action|wait_then_retry|patch_config|abort", "reason": "...", "confidence": "high|medium|low", ...optional fields }
  2. retry — provide "selector", optional "action", optional "value" for a new attempt. Never use [value="..."] for fill selectors.
  3. skip_action — action is redundant or harmful (e.g. re-clicking already-selected Loan Amount card resets UI to ₹0)
  4. wait_then_retry — async UI not ready; provide "waitMs" (1000-5000)
  5. patch_config — config step definition is wrong; provide "patch" with ONLY flow-step fields:
     { "removeActionIndexes": [0], "replaceActions": [...], "replaceAssertions": [...], "addNotes": "..." }
     Use patch_config with confidence "high" when:
       - url_contains fails but next screen text is visible (SPA modal — use element_visible assertion instead)
       - an action should be removed because it breaks state
       - assertion type should change from url_contains to element_visible
     NEVER replace assertions with text from the current (wrong) page when navigation has not completed yet.
     Example: do not change 'Total Loan Amount' (offer page) to 'Loan Amount' (gold-weight page) — that masks a failed Show My Offers click.
  6. abort — wrong credentials, hard app bug, or unrecoverable
  7. LP2 SPA rules:
     - Auth modal stays on /lp/b2c/2 until PAN confirm — do not expect confirm-details URL in modal steps
     - Prefer element_visible over url_contains when URL unchanged but screen changed
     - Preference cards: click "Select" button, not re-click active card
     - Never [value=...] fill selectors
  8. Meeting slots (/meeting-slots/v1) rules:
     - If time slot click fails or times out, the selected date likely has no slots — use retry with selector for the next available date in the calendar, then retry the time slot
     - Try up to 3 different dates before emergency fallback
     - Emergency fallback (no slots on any date): click "Need an emergency slot?", select first slot in popup, click "Book Emergency Slot"
     - Do not click Continue until a time slot is selected`;

let client: Anthropic | null = null;
let totalApiCostEstimate = 0;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonResponse<T>(text: string): T {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON object found in response: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(jsonMatch[0]) as T;
}

async function callClaude(
  system: string,
  userContent: Anthropic.MessageCreateParams['messages'][0]['content'],
  maxTokens: number,
  stepLabel: string
): Promise<string> {
  const anthropic = getClient();
  const delays = [1000, 2000, 4000];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const start = Date.now();
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: userContent }],
      });

      const latency = Date.now() - start;
      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock?.type === 'text' ? textBlock.text : '';

      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      totalApiCostEstimate += (inputTokens * 3 + outputTokens * 15) / 1_000_000;

      console.log(
        `[API] ${stepLabel} | tokens: ${inputTokens}+${outputTokens} | ${latency}ms`
      );

      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) {
        await sleep(delays[attempt]);
      }
    }
  }

  throw lastError ?? new Error('AI agent unavailable');
}

async function callClaudeJson<T>(
  system: string,
  userContent: Anthropic.MessageCreateParams['messages'][0]['content'],
  maxTokens: number,
  stepLabel: string
): Promise<T> {
  const textHint =
    typeof userContent === 'string'
      ? userContent
      : (userContent.find((b) => b.type === 'text') as { text: string } | undefined)?.text ?? '';

  try {
    const text = await callClaude(system, userContent, maxTokens, stepLabel);
    return parseJsonResponse<T>(text);
  } catch {
    const retryContent: Anthropic.MessageCreateParams['messages'][0]['content'] =
      typeof userContent === 'string'
        ? `${textHint}\n\nIMPORTANT: Return ONLY valid raw JSON. No markdown fences. No explanation.`
        : [
            ...userContent.filter((b) => b.type !== 'text'),
            {
              type: 'text' as const,
              text: `${textHint}\n\nIMPORTANT: Return ONLY valid raw JSON. No markdown fences. No explanation.`,
            },
          ];
    const text = await callClaude(system, retryContent, maxTokens, `${stepLabel}-retry`);
    return parseJsonResponse<T>(text);
  }
}

function resolveEnvTemplates(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{env\.(\w+)\}\}/g, (_, key: string) => {
      return process.env[key] ?? '';
    });
  }
  if (Array.isArray(value)) {
    return value.map(resolveEnvTemplates);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveEnvTemplates(v);
    }
    return result;
  }
  return value;
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function resolveTemplateString(
  template: string,
  data: Record<string, unknown>
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const trimmed = path.trim();
    if (SPECIAL_TEMPLATE_PREFIXES.some((p) => trimmed.startsWith(p))) {
      return `{{${trimmed}}}`;
    }
    if (trimmed.startsWith('env.')) {
      const envVal = process.env[trimmed.slice(4)];
      return envVal ?? '';
    }
    const val = getNestedValue(data, trimmed);
    return val !== undefined && val !== null ? String(val) : '';
  });
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export function parseVariant(): FlowVariant {
  const idx = process.argv.indexOf('--variant');
  if (idx !== -1 && process.argv[idx + 1]) {
    const v = process.argv[idx + 1];
    if (v === 'fresh' || v === 'takeover') return v;
  }
  const envVariant = process.env.TEST_VARIANT;
  if (envVariant === 'fresh' || envVariant === 'takeover') return envVariant;
  return 'fresh';
}

export function getRulesConfigPath(variant?: FlowVariant): string {
  const v = variant ?? parseVariant();
  return path.join(process.cwd(), 'config', `test-rules-${v}.config.json`);
}

export function resolveTemplates(
  rules: TestRules,
  overrides?: ErrorCaseOverride
): TestRules {
  const cloned = deepClone(rules) as unknown as Record<string, unknown>;

  if (overrides) {
    for (const [dotPath, value] of Object.entries(overrides)) {
      if (SPECIAL_OVERRIDE_KEYS.has(dotPath)) continue;
      if (typeof value === 'string' || typeof value === 'number') {
        setNestedValue(cloned, dotPath, value);
      }
    }
  }

  const resolve = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return resolveTemplateString(value, cloned);
    }
    if (Array.isArray(value)) {
      return value.map(resolve);
    }
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = resolve(v);
      }
      return result;
    }
    return value;
  };

  return resolve(cloned) as unknown as TestRules;
}

export function loadRules(configPath?: string): TestRules {
  const filePath = configPath ?? getRulesConfigPath();
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as TestRules;
  return resolveEnvTemplates(parsed) as TestRules;
}

export async function planStep(
  stepName: string,
  action: TestAction,
  pageHTML: string,
  currentUrl: string,
  screenshotBase64?: string,
  context?: PlanStepContext
): Promise<PlanStepResult> {
  const userMessage = JSON.stringify({
    step: stepName,
    action,
    currentUrl,
    pageHTML: pageHTML.slice(0, 50000),
    priorError: context?.priorError,
    failedSelector: context?.failedSelector,
    avoidSelectors: context?.avoidSelectors,
  });

  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = screenshotBase64
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: screenshotBase64,
          },
        },
        { type: 'text', text: userMessage },
      ]
    : userMessage;

  const result = await callClaudeJson<PlanStepResult>(
    PLAN_STEP_SYSTEM,
    content,
    1024,
    `planStep:${stepName}:${action.label}`
  );

  return {
    selector: result.selector,
    action: result.action ?? action.type,
    value: result.value ?? action.value,
  };
}

export async function diagnoseFailure(failure: FailureContext): Promise<RecoveryPlan> {
  const userMessage = JSON.stringify({
    step: failure.step,
    context: failure.context,
    action: failure.action,
    actionIndex: failure.actionIndex,
    assertion: failure.assertion,
    assertionIndex: failure.assertionIndex,
    error: failure.error,
    failedSelector: failure.failedSelector,
    currentUrl: failure.currentUrl,
    pageHTML: failure.pageHTML.slice(0, 50000),
  });

  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = failure.screenshotBase64
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: failure.screenshotBase64,
          },
        },
        { type: 'text', text: userMessage },
      ]
    : userMessage;

  const result = await callClaudeJson<RecoveryPlan>(
    DIAGNOSE_FAILURE_SYSTEM,
    content,
    1024,
    `heal:step${failure.step.step}:${failure.context}`
  );

  return {
    type: result.type ?? 'abort',
    reason: result.reason ?? 'No recovery reason provided',
    confidence: result.confidence,
    selector: result.selector,
    action: result.action,
    value: result.value,
    waitMs: result.waitMs,
    patch: result.patch,
  };
}

export async function evaluateAssertion(
  assertion: TestAssertion,
  pageHTML: string,
  currentUrl: string,
  screenshotBase64?: string
): Promise<AssertionResult> {
  const userMessage = JSON.stringify({
    assertion,
    currentUrl,
    pageHTML: pageHTML.slice(0, 50000),
  });

  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = screenshotBase64
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: screenshotBase64,
          },
        },
        { type: 'text', text: userMessage },
      ]
    : userMessage;

  return callClaudeJson<AssertionResult>(
    EVALUATE_ASSERTION_SYSTEM,
    content,
    512,
    `assertion:${assertion.type}`
  );
}

export async function generateReportSummary(result: RunResult): Promise<string> {
  try {
    const text = await callClaude(
      REPORT_SUMMARY_SYSTEM,
      JSON.stringify(result),
      2048,
      'reportSummary'
    );
    return text.trim();
  } catch {
    return `Run completed: ${result.passed} passed, ${result.failed} failed out of ${result.totalSteps} steps.`;
  }
}

export function getApiCostEstimate(): number {
  return totalApiCostEstimate;
}

export function getUploadFileOverride(overrides?: ErrorCaseOverride): string | undefined {
  if (!overrides?.uploadFile) return undefined;
  return String(overrides.uploadFile);
}

export function getErrorCaseOptions(overrides?: ErrorCaseOverride) {
  return {
    skipConsent: overrides?.uncheckConsent === true,
    clearCookiesBefore: Array.isArray(overrides?.clearCookies)
      ? (overrides.clearCookies as string[])
      : undefined,
    useEmergencySlot: overrides?.useEmergencySlot === true,
    uploadFileOverride: getUploadFileOverride(overrides),
  };
}
