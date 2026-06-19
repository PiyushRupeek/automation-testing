import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  ErrorCase,
  FlowStep,
  FlowVariant,
  RunMode,
  RunResult,
  Scenario,
  StateManagementRules,
  StepResult,
  StepRunOptions,
  TestAction,
  TestRules,
  isStateManagementRules,
} from '../../common/types';
import { AgentService } from '../agent/agent.service';
import { BrowserService } from '../browser/browser.service';
import { ConfigRulesService } from '../config-rules/config-rules.service';
import { FlowStepService } from '../flow-step/flow-step.service';
import { HealSession, HealerService } from '../healer/healer.service';
import { ReportsService } from '../reports/reports.service';
import { RunOutputService } from '../reports/run-output.service';
import { RunTestSuiteOptions } from './dto/start-run.dto';

@Injectable()
export class TestEngineService {
  constructor(
    private readonly configRules: ConfigRulesService,
    private readonly flowStep: FlowStepService,
    private readonly browserService: BrowserService,
    private readonly healer: HealerService,
    private readonly agent: AgentService,
    private readonly reports: ReportsService,
    private readonly runOutput: RunOutputService
  ) {}

  parseMode(variant: FlowVariant, argv: string[]): RunMode {
    const idx = argv.indexOf('--mode');
    if (idx === -1 || !argv[idx + 1]) {
      return variant === 'state-management' ? 'scenarios' : 'all';
    }
    const mode = argv[idx + 1] as RunMode;
    if (mode === 'happy' || mode === 'errors' || mode === 'all' || mode === 'scenarios') return mode;
    return variant === 'state-management' ? 'scenarios' : 'all';
  }

  buildUrl(baseUrl: string, stepUrl?: string): string {
    if (!stepUrl) return baseUrl;
    if (stepUrl.startsWith('http://') || stepUrl.startsWith('https://')) return stepUrl;
    try {
      const base = new URL(baseUrl);
      const pathPart = stepUrl.startsWith('/') ? stepUrl : `/${stepUrl}`;
      return `${base.origin}${pathPart}`;
    } catch {
      const base = baseUrl.replace(/\/$/, '');
      const pathPart = stepUrl.startsWith('/') ? stepUrl : `/${stepUrl}`;
      return `${base}${pathPart}`;
    }
  }

  getEmergencySlotActions(): TestAction[] {
    return [
      { type: 'click', label: 'Need an emergency slot?' },
      { type: 'click', label: 'First available slot in Choose Emergency Slots popup' },
      { type: 'click', label: 'Book Emergency Slot' },
    ];
  }

  shouldSkipAction(action: TestAction, options?: StepRunOptions): boolean {
    if (options?.skipConsent && action.type === 'check') {
      const label = (action.label ?? '').toLowerCase();
      if (label.includes('consent') || label.includes('terms')) return true;
    }
    return false;
  }

  checkExpectedError(
    pageHTML: string,
    currentUrl: string,
    expectedError: string,
    lastResult?: StepResult | null
  ): boolean {
    const lower = expectedError.toLowerCase();
    const htmlLower = pageHTML.toLowerCase();

    if (lower.startsWith('must not')) {
      if (lower.includes('must not contain')) {
        const pathPart = expectedError.replace(/.*must not contain\s+/i, '');
        const paths = pathPart.split(/\s+or\s+/).map((p) => p.trim()).filter(Boolean);
        return !paths.some((p) => currentUrl.includes(p));
      }
      const forbidden: string[] = [];
      if (lower.includes('enter pincode')) forbidden.push('enter pincode');
      if (lower.includes('what are you looking for')) forbidden.push('what are you looking for');
      return !forbidden.some((f) => htmlLower.includes(f));
    }

    if (lower.includes('redirect') && (lower.includes('landing') || lower.includes('auth'))) {
      return (
        (currentUrl.includes('/lp/b2c/2') || currentUrl.endsWith('/lp/b2c/2')) &&
        !currentUrl.includes('/offer-page') &&
        !currentUrl.includes('/gold-weight-details') &&
        !currentUrl.includes('/shift-your-loan')
      );
    }

    return (
      htmlLower.includes(lower) ||
      (lastResult?.error?.toLowerCase().includes(lower) ?? false)
    );
  }

  async runFromCli(argv: string[]): Promise<number> {
    const variant = this.configRules.parseVariantFromArgv(argv);
    const mode = this.parseMode(variant, argv);
    const result = await this.runTestSuite({ variant, mode, argv });
    return result.failed > 0 ? 1 : 0;
  }

  async runTestSuite(options: RunTestSuiteOptions): Promise<RunResult & { runDir: string; htmlPath: string }> {
    const argv = options.argv ?? process.argv;
    const variant = options.variant;
    const mode = options.mode ?? this.parseMode(variant, argv);
    const runStart = Date.now();
    const runId = options.runId ?? crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const autoHeal =
      options.autoHeal !== undefined
        ? options.autoHeal
        : this.healer.isAutoHealEnabled(argv);

    this.agent.resetCostEstimate();

    const { runDir, screenshotsDir, dirName } = this.runOutput.createRunOutputDir(timestamp, variant, mode);

    console.log(`Starting test run (${variant}, ${mode}) — ${runId}`);
    console.log(`Run output: reports/${dirName}/`);
    if (autoHeal) {
      console.log('Self-healing enabled (use --no-auto-heal to disable)');
    }

    options.onProgress?.({ type: 'run_started' });

    const configPath = this.configRules.getRulesConfigPath(variant);
    const rules = this.configRules.loadRules(configPath, variant);
    const browser = this.browserService.createForRun(screenshotsDir);
    const stepResults: StepResult[] = [];

    try {
      await browser.launch();

      if (isStateManagementRules(rules)) {
        const stateRules = this.configRules.resolveTemplates(rules) as StateManagementRules;
        const runScenarios = mode === 'scenarios' || mode === 'happy' || mode === 'all';
        const runErrors = mode === 'errors' || mode === 'all';

        if (runScenarios) {
          for (const scenario of stateRules.scenarios) {
            console.log(`\nScenario: ${scenario.name} (${scenario.id})`);
            const scenarioHeal = autoHeal
              ? this.healer.createSession(runId, configPath, variant, runDir, scenario.id)
              : undefined;
            const results = await this.runScenario(browser, scenario, stateRules, scenarioHeal, options, runId);
            stepResults.push(...results);
            if (scenarioHeal && (scenarioHeal.attempts.length > 0 || scenarioHeal.configPatches.length > 0)) {
              const healLogPath = scenarioHeal.writeHealLog();
              console.log(`Heal log for ${scenario.id}: ${healLogPath}`);
            }
          }
        }

        if (runErrors) {
          for (const errorCase of stateRules.errorCases) {
            console.log(`Running error case: ${errorCase.name}`);
            await browser.navigate(stateRules.site.baseUrl, stateRules.site.timeout);
            const result = await this.runStateManagementErrorCase(browser, errorCase, stateRules, undefined, options, runId);
            stepResults.push(result);
            console.log(`  → ${result.status}${result.error ? `: ${result.error}` : ''}`);
          }
        }
      } else {
        const resolvedRules = this.configRules.resolveTemplates(rules) as TestRules;
        const healSession = autoHeal ? this.healer.createSession(runId, configPath, variant, runDir) : undefined;

        await browser.navigate(resolvedRules.site.baseUrl, resolvedRules.site.timeout);

        if (mode === 'happy' || mode === 'all') {
          for (const step of resolvedRules.flow) {
            console.log(`Running step ${step.step}: ${step.name}`);
            options.onProgress?.({ type: 'step_started', step: step.step, stepName: step.name });
            const result = await this.runFlowStep(browser, step, resolvedRules, {
              timeout: resolvedRules.site.timeout,
            }, healSession, runId);
            stepResults.push(result);
            options.onProgress?.({
              type: 'step_completed',
              step: step.step,
              stepName: step.name,
              status: result.status,
              error: result.error,
            });
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
            const result = await this.runErrorCase(browser, errorCase, resolvedRules, healSession, options, runId);
            stepResults.push(result);
            console.log(`  → ${result.status}${result.error ? `: ${result.error}` : ''}`);
          }
        }

        if (healSession && (healSession.attempts.length > 0 || healSession.configPatches.length > 0)) {
          const healLogPath = healSession.writeHealLog();
          console.log(`Heal log written to ${healLogPath}`);
          console.log(
            `Self-heal: ${healSession.attempts.length} attempt(s), ${healSession.configPatches.length} config patch(es)`
          );
        }
      }
    } finally {
      await browser.close();
    }

    const passed = stepResults.filter((s) => s.status === 'pass').length;
    const failed = stepResults.filter((s) => s.status === 'fail').length;

    const siteName = isStateManagementRules(rules)
      ? (this.configRules.resolveTemplates(rules) as StateManagementRules).site.name
      : (this.configRules.resolveTemplates(rules) as TestRules).site.name;

    const runResult: RunResult = {
      runId,
      timestamp,
      site: siteName,
      totalSteps: stepResults.length,
      passed,
      failed,
      steps: stepResults,
      duration: Date.now() - runStart,
      apiCostEstimate: this.agent.getApiCostEstimate(),
    };

    try {
      runResult.summary = await this.agent.generateReportSummary(runResult);
    } catch {
      runResult.summary = `${passed} passed, ${failed} failed.`;
    }

    const { htmlPath } = this.reports.generateHTML(runResult, runDir);
    console.log(`Report written to ${htmlPath}`);

    const notifications = isStateManagementRules(rules)
      ? (this.configRules.resolveTemplates(rules) as StateManagementRules).notifications
      : (this.configRules.resolveTemplates(rules) as TestRules).notifications;

    if (failed > 0 && notifications.slackWebhook) {
      try {
        await this.sendSlackNotification(notifications.slackWebhook, runResult, htmlPath);
        console.log('Slack notification sent');
      } catch (err) {
        console.warn('Failed to send Slack notification:', err);
      }
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed (${runResult.duration}ms)`);

    return { ...runResult, runDir, htmlPath };
  }

  private async runFlowStep(
    browser: ReturnType<BrowserService['createForRun']>,
    step: FlowStep,
    rules: TestRules,
    stepOptions?: StepRunOptions,
    healSession?: HealSession,
    runId?: string
  ): Promise<StepResult> {
    return this.flowStep.runFlowStepWithHeal(
      browser,
      step,
      rules,
      stepOptions,
      healSession,
      this.buildUrl.bind(this),
      this.shouldSkipAction.bind(this),
      this.getEmergencySlotActions.bind(this),
      runId
    );
  }

  private async runScenario(
    browser: ReturnType<BrowserService['createForRun']>,
    scenario: Scenario,
    stateRules: StateManagementRules,
    healSession: HealSession | undefined,
    options: RunTestSuiteOptions,
    runId: string
  ): Promise<StepResult[]> {
    const scenarioRules = this.configRules.resolveTemplates(
      this.configRules.scenarioToTestRules(stateRules, scenario)
    ) as TestRules;
    const results: StepResult[] = [];
    const prefix = `[${scenario.id}]`;

    await browser.resetSessionState();
    await browser.navigate(scenarioRules.site.baseUrl, scenarioRules.site.timeout);
    await browser.clearPageStorage();

    for (const step of scenarioRules.flow) {
      console.log(`Running ${prefix} step ${step.step}: ${step.name}`);
      options.onProgress?.({ type: 'step_started', step: step.step, stepName: `${prefix} ${step.name}` });
      const result = await this.runFlowStep(browser, step, scenarioRules, {
        timeout: scenarioRules.site.timeout,
        artifactPrefix: scenario.id,
      }, healSession, runId);

      const named = { ...result, name: `${prefix} ${result.name}` };
      results.push(named);
      options.onProgress?.({
        type: 'step_completed',
        step: step.step,
        stepName: named.name,
        status: result.status,
        error: result.error,
      });

      console.log(`  → ${result.status}${result.error ? `: ${result.error}` : ''}`);
      if (result.status === 'fail') {
        console.log(`Stopping scenario ${scenario.id} — step ${step.step} failed.`);
        break;
      }
    }

    return results;
  }

  private async runErrorCase(
    browser: ReturnType<BrowserService['createForRun']>,
    errorCase: ErrorCase,
    rules: TestRules,
    healSession: HealSession | undefined,
    options: RunTestSuiteOptions,
    runId: string
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

    const resolvedRules = this.configRules.resolveTemplates(rules, errorCase.override) as TestRules;
    const errorOpts = this.configRules.getErrorCaseOptions(errorCase.override);

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

      options.onProgress?.({ type: 'step_started', step: step.step, stepName: step.name });
      lastResult = await this.runFlowStep(browser, step, resolvedRules, stepOptions, healSession, runId);
      options.onProgress?.({
        type: 'step_completed',
        step: step.step,
        stepName: step.name,
        status: lastResult.status,
        error: lastResult.error,
      });

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
    const errorVisible = this.checkExpectedError(
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
        : `Expected condition "${errorCase.expectedError}" not met`,
      duration: Date.now() - start,
      actions: lastResult?.actions ?? [],
      assertions: [
        {
          type: 'element_visible',
          label: errorCase.expectedError,
          pass: errorVisible,
          reason: errorVisible
            ? `Condition "${errorCase.expectedError}" satisfied`
            : `Condition "${errorCase.expectedError}" not satisfied`,
        },
      ],
    };
  }

  private async runStateManagementErrorCase(
    browser: ReturnType<BrowserService['createForRun']>,
    errorCase: ErrorCase,
    stateRules: StateManagementRules,
    healSession: HealSession | undefined,
    options: RunTestSuiteOptions,
    runId: string
  ): Promise<StepResult> {
    if (!errorCase.scenario) {
      return {
        step: errorCase.step,
        name: `Error: ${errorCase.name}`,
        status: 'fail',
        error: 'State-management error case requires a scenario id',
        duration: 0,
        actions: [],
        assertions: [],
      };
    }

    const scenario = stateRules.scenarios.find((s) => s.id === errorCase.scenario);
    if (!scenario) {
      return {
        step: errorCase.step,
        name: `Error: ${errorCase.name}`,
        status: 'fail',
        error: `Scenario "${errorCase.scenario}" not found`,
        duration: 0,
        actions: [],
        assertions: [],
      };
    }

    const scenarioRules = this.configRules.resolveTemplates(
      this.configRules.scenarioToTestRules(stateRules, scenario)
    ) as TestRules;
    await browser.resetSessionState();
    await browser.navigate(stateRules.site.baseUrl, stateRules.site.timeout);
    await browser.clearPageStorage();
    return this.runErrorCase(browser, errorCase, scenarioRules, healSession, options, runId);
  }

  private async sendSlackNotification(
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
}
