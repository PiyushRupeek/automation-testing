import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AssertionResult,
  FailureContext,
  PlanStepContext,
  PlanStepResult,
  RecoveryPlan,
  RunResult,
  TestAction,
  TestAssertion,
} from '../../common/types';
import { CLAUDE_MODEL } from '../../common/constants';

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

@Injectable()
export class AgentService {
  private client: Anthropic | null = null;
  private totalApiCostEstimate = 0;

  resetCostEstimate(): void {
    this.totalApiCostEstimate = 0;
  }

  getApiCostEstimate(): number {
    return this.totalApiCostEstimate;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseJsonResponse<T>(text: string): T {
    const trimmed = text.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON object found in response: ${trimmed.slice(0, 200)}`);
    }
    return JSON.parse(jsonMatch[0]) as T;
  }

  private async callClaude(
    system: string,
    userContent: Anthropic.MessageCreateParams['messages'][0]['content'],
    maxTokens: number,
    stepLabel: string
  ): Promise<string> {
    const anthropic = this.getClient();
    const delays = [1000, 2000, 4000];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const start = Date.now();
      try {
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
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
        this.totalApiCostEstimate += (inputTokens * 3 + outputTokens * 15) / 1_000_000;

        console.log(`[API] ${stepLabel} | tokens: ${inputTokens}+${outputTokens} | ${latency}ms`);

        return text;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < 2) {
          await this.sleep(delays[attempt]);
        }
      }
    }

    if (lastError && 'status' in lastError && (lastError as { status?: number }).status === 404) {
      throw new Error(
        `Claude model "${CLAUDE_MODEL}" not found. Set ANTHROPIC_MODEL in .env (e.g. claude-sonnet-4-6).`
      );
    }

    throw lastError ?? new Error('AI agent unavailable');
  }

  private async callClaudeJson<T>(
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
      const text = await this.callClaude(system, userContent, maxTokens, stepLabel);
      return this.parseJsonResponse<T>(text);
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
      const text = await this.callClaude(system, retryContent, maxTokens, `${stepLabel}-retry`);
      return this.parseJsonResponse<T>(text);
    }
  }

  async planStep(
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

    const result = await this.callClaudeJson<PlanStepResult>(
      PLAN_STEP_SYSTEM,
      content,
      1024,
      `planStep:${stepName}:${action.label ?? action.type}`
    );

    return {
      selector: result.selector,
      action: result.action ?? action.type,
      value: result.value ?? action.value,
    };
  }

  async diagnoseFailure(failure: FailureContext): Promise<RecoveryPlan> {
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

    const result = await this.callClaudeJson<RecoveryPlan>(
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

  async evaluateAssertion(
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

    return this.callClaudeJson<AssertionResult>(
      EVALUATE_ASSERTION_SYSTEM,
      content,
      512,
      `assertion:${assertion.type}`
    );
  }

  async generateReportSummary(result: RunResult): Promise<string> {
    try {
      const text = await this.callClaude(
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
}
