import 'dotenv/config';
import * as crypto from 'crypto';
import {
  generateReportSummary,
  getApiCostEstimate,
  getErrorCaseOptions,
  loadRules,
  parseVariant,
  resolveTemplates,
  getRulesConfigPath,
} from './agent';
import { BrowserController } from './browser';
import { runFlowStepWithHeal } from './flow-step';
import { HealSession, isAutoHealEnabled } from './healer';
import { generateHTML } from './reporter';
import {
  ErrorCase,
  RunMode,
  RunResult,
  StepResult,
  StepRunOptions,
  TestAction,
  TestRules,
} from './types';

function parseMode(): RunMode {
  const idx = process.argv.indexOf('--mode');
  if (idx === -1 || !process.argv[idx + 1]) return 'all';
  const mode = process.argv[idx + 1] as RunMode;
  if (mode === 'happy' || mode === 'errors' || mode === 'all') return mode;
  return 'all';
}

function buildUrl(baseUrl: string, stepUrl?: string): string {
  if (!stepUrl) return baseUrl;
  if (stepUrl.startsWith('http://') || stepUrl.startsWith('https://')) return stepUrl;
  try {
    const base = new URL(baseUrl);
    const path = stepUrl.startsWith('/') ? stepUrl : `/${stepUrl}`;
    return `${base.origin}${path}`;
  } catch {
    const base = baseUrl.replace(/\/$/, '');
    const path = stepUrl.startsWith('/') ? stepUrl : `/${stepUrl}`;
    return `${base}${path}`;
  }
}

function getEmergencySlotActions(): TestAction[] {
  return [
    { type: 'click', label: 'Need an emergency slot?' },
    { type: 'click', label: 'First available slot in Choose Emergency Slots popup' },
    { type: 'click', label: 'Book Emergency Slot' },
  ];
}

function shouldSkipAction(action: TestAction, options?: StepRunOptions): boolean {
  if (options?.skipConsent && action.type === 'check') {
    const label = action.label.toLowerCase();
    if (label.includes('consent') || label.includes('terms')) return true;
  }
  return false;
}

function checkExpectedError(
  pageHTML: string,
  currentUrl: string,
  expectedError: string,
  lastResult?: StepResult | null
): boolean {
  const lower = expectedError.toLowerCase();
  if (lower.includes('redirect') && (lower.includes('landing') || lower.includes('auth'))) {
    return currentUrl.includes('/lp/b2c/') && !currentUrl.includes('/loan-type/');
  }
  return (
    pageHTML.toLowerCase().includes(lower) ||
    (lastResult?.error?.toLowerCase().includes(lower) ?? false)
  );
}

async function runFlowStep(
  browser: BrowserController,
  step: import('./types').FlowStep,
  rules: TestRules,
  options?: StepRunOptions,
  healSession?: HealSession
): Promise<StepResult> {
  return runFlowStepWithHeal(
    browser,
    step,
    rules,
    options,
    healSession,
    buildUrl,
    shouldSkipAction,
    getEmergencySlotActions
  );
}

async function runErrorCase(
  browser: BrowserController,
  errorCase: ErrorCase,
  rules: TestRules,
  healSession?: HealSession
): Promise<StepResult> {
  const start = Date.now();
  const targetStep = rules.flow.find((s) => s.step === errorCase.step);
  const stepName = `Error: ${errorCase.name}`;

  if (!targetStep) {
    return {
      step: errorCase.step,
      name: stepName,
      status: 'fail',
      error: `Step ${errorCase.step} not found in flow`,
      duration: Date.now() - start,
      actions: [],
      assertions: [],
    };
  }

  const resolvedRules = resolveTemplates(rules, errorCase.override);
  const errorOpts = getErrorCaseOptions(errorCase.override);

  const stepsToRun = rules.flow.filter((s) => s.step <= errorCase.step);
  let lastResult: StepResult | null = null;

  await browser.navigate(resolvedRules.site.baseUrl, rules.site.timeout);

  for (const step of stepsToRun) {
    const isTarget = step.step === errorCase.step;
    const stepOptions: StepRunOptions = {
      timeout: rules.site.timeout,
      ...(isTarget ? errorOpts : {}),
    };

    if (isTarget && errorOpts.uploadFileOverride) {
      stepOptions.uploadFileOverride = errorOpts.uploadFileOverride;
    }

    lastResult = await runFlowStep(browser, step, resolvedRules, stepOptions, healSession);

    if (lastResult.status === 'fail' && step.step < errorCase.step) {
      return {
        ...lastResult,
        name: stepName,
        error: `Prerequisite step ${step.step} failed before error case`,
      };
    }

    if (isTarget) break;
  }

  const pageHTML = await browser.getPageHTML();
  const currentUrl = browser.getCurrentUrl();
  const errorVisible = checkExpectedError(
    pageHTML,
    currentUrl,
    errorCase.expectedError,
    lastResult
  );

  const screenshot = await browser.screenshot(
    `error-${errorCase.step}-${errorCase.name.replace(/\s+/g, '-').toLowerCase()}.png`
  );

  return {
    step: errorCase.step,
    name: stepName,
    status: errorVisible ? 'pass' : 'fail',
    screenshot,
    error: errorVisible
      ? undefined
      : `Expected error "${errorCase.expectedError}" not found on page`,
    duration: Date.now() - start,
    actions: lastResult?.actions ?? [],
    assertions: [
      {
        type: 'element_visible',
        label: errorCase.expectedError,
        pass: errorVisible,
        reason: errorVisible
          ? `Error message "${errorCase.expectedError}" detected`
          : `Error message "${errorCase.expectedError}" not detected`,
      },
    ],
  };
}

async function sendSlackNotification(
  webhookUrl: string,
  result: RunResult,
  reportPath: string
): Promise<void> {
  if (!webhookUrl || webhookUrl.includes('placeholder')) return;

  const payload = {
    text: `Test run failed: ${result.failed}/${result.totalSteps} steps failed for ${result.site}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${result.site}* — ${result.failed} failure(s)\nRun: ${result.runId}\nReport: ${reportPath}`,
        },
      },
    ],
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function main(): Promise<void> {
  const mode = parseMode();
  const variant = parseVariant();
  const runStart = Date.now();
  const runId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const autoHeal = isAutoHealEnabled();
  console.log(`Starting test run (${variant}, ${mode}) — ${runId}`);
  if (autoHeal) {
    console.log('Self-healing enabled (use --no-auto-heal to disable)');
  }

  const rules = loadRules();
  const resolvedRules = resolveTemplates(rules);
  const configPath = getRulesConfigPath();
  const healSession = autoHeal ? new HealSession(runId, configPath, variant) : undefined;
  const browser = new BrowserController();
  const stepResults: StepResult[] = [];

  try {
    await browser.launch();
    await browser.navigate(resolvedRules.site.baseUrl, resolvedRules.site.timeout);

    if (mode === 'happy' || mode === 'all') {
      for (const step of resolvedRules.flow) {
        console.log(`Running step ${step.step}: ${step.name}`);
        const result = await runFlowStep(browser, step, resolvedRules, {
          timeout: resolvedRules.site.timeout,
        }, healSession);
        stepResults.push(result);
        console.log(`  → ${result.status}${result.error ? `: ${result.error}` : ''}`);
        if (result.status === 'fail') {
          console.log('Stopping happy path — fix the failed step before continuing.');
          break;
        }
      }
    }

    if (mode === 'errors' || mode === 'all') {
      for (const errorCase of resolvedRules.errorCases) {
        console.log(`Running error case: ${errorCase.name}`);
        await browser.navigate(resolvedRules.site.baseUrl, resolvedRules.site.timeout);
        const result = await runErrorCase(browser, errorCase, resolvedRules, healSession);
        stepResults.push(result);
        console.log(`  → ${result.status}${result.error ? `: ${result.error}` : ''}`);
      }
    }
  } finally {
    await browser.close();
  }

  const passed = stepResults.filter((s) => s.status === 'pass').length;
  const failed = stepResults.filter((s) => s.status === 'fail').length;

  const runResult: RunResult = {
    runId,
    timestamp,
    site: resolvedRules.site.name,
    totalSteps: stepResults.length,
    passed,
    failed,
    steps: stepResults,
    duration: Date.now() - runStart,
    apiCostEstimate: getApiCostEstimate(),
    healLog: healSession?.toHealLog(),
  };

  if (healSession && (healSession.attempts.length > 0 || healSession.configPatches.length > 0)) {
    const healLogPath = healSession.writeHealLog();
    console.log(`Heal log written to ${healLogPath}`);
    console.log(
      `Self-heal: ${healSession.attempts.length} attempt(s), ${healSession.configPatches.length} config patch(es)`
    );
  }

  try {
    runResult.summary = await generateReportSummary(runResult);
  } catch {
    runResult.summary = `${passed} passed, ${failed} failed.`;
  }

  const { htmlPath } = generateHTML(runResult);
  console.log(`Report written to ${htmlPath}`);

  if (failed > 0 && resolvedRules.notifications.slackWebhook) {
    try {
      await sendSlackNotification(
        resolvedRules.notifications.slackWebhook,
        runResult,
        htmlPath
      );
      console.log('Slack notification sent');
    } catch (err) {
      console.warn('Failed to send Slack notification:', err);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed (${runResult.duration}ms)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
