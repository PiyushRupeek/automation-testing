import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  ActionType,
  FlowStep,
  FlowVariant,
  TestRules,
  isStateManagementRules,
} from '../../common/types';
import { ConfigRulesService } from '../config-rules/config-rules.service';
import { HealerService } from '../healer/healer.service';
import { StagehandBrowserAdapter } from './stagehand-browser.adapter';
import { ScreenAnalyzerService } from './screen-analyzer.service';
import { FlowGeneratorService } from './flow-generator.service';
import { TemplateResolverService } from './template-resolver.service';
import { DiffMergeService } from './diff-merge.service';
import { FlowDescriptor } from './types/flow-descriptor.types';
import {
  AuthBarrier,
  ExplorationStep,
  ExploreMode,
  ExploreOptions,
  ExploreResult,
  PerformedAction,
  ScreenObservation,
} from './types/explorer.types';

const DEFAULT_MAX_STEPS = 20;
const LOOP_DETECTION_THRESHOLD = 3;
const DEFAULT_VARIANT = 'fresh' as const;

@Injectable()
export class ExplorerService {
  constructor(
    private readonly browser: StagehandBrowserAdapter,
    private readonly screenAnalyzer: ScreenAnalyzerService,
    private readonly flowGenerator: FlowGeneratorService,
    private readonly templateResolver: TemplateResolverService,
    private readonly diffMerge: DiffMergeService,
    private readonly configRules: ConfigRulesService,
    private readonly healer: HealerService,
  ) {}

  async explore(options: ExploreOptions): Promise<ExploreResult> {
    const start = Date.now();

    try {
      switch (options.mode) {
        case 'explore':
          return await this.exploreMode(options);
        case 'verify':
          return await this.verifyMode(options);
        case 'update':
          return await this.updateMode(options);
        default:
          throw new Error(`Unknown explore mode: ${options.mode}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[Explorer] Fatal error: ${error}`);
      return {
        mode: options.mode,
        status: 'failed',
        baseUrl: options.baseUrl ?? '',
        completedSteps: 0,
        generatedFlow: [],
        explorationLog: [],
        authBarriers: [],
        duration: Date.now() - start,
        error,
      };
    }
  }

  async runFromCli(argv: string[]): Promise<number> {
    const options = this.parseCliArgs(argv);
    console.log(`[Explorer] Starting exploration: mode=${options.mode}, variant=${options.variant ?? 'auto'}`);

    const result = await this.explore(options);

    console.log(`\n[Explorer] Result: ${result.status}`);
    console.log(`  Steps explored: ${result.completedSteps}`);
    console.log(`  Flow steps generated: ${result.generatedFlow.length}`);
    console.log(`  Auth barriers: ${result.authBarriers.length}`);
    console.log(`  Duration: ${result.duration}ms`);

    if (result.diff) {
      console.log(`  Added steps: ${result.diff.addedSteps.length}`);
      console.log(`  Removed steps: ${result.diff.removedSteps.length}`);
      console.log(`  Changed steps: ${result.diff.changedSteps.length}`);
      console.log(`  Unchanged: ${result.diff.unchangedStepNumbers.length}`);
    }

    if (result.error) {
      console.error(`  Error: ${result.error}`);
    }

    if (result.generatedConfig) {
      const outPath = this.getOutputConfigPath(options);
      fs.writeFileSync(outPath, JSON.stringify(result.generatedConfig, null, 2) + '\n', 'utf-8');
      console.log(`  Config written to: ${outPath}`);
    }

    return result.status === 'failed' ? 1 : 0;
  }

  // --- Explore Mode ---

  private async exploreMode(options: ExploreOptions): Promise<ExploreResult> {
    const start = Date.now();
    const descriptor = this.loadDescriptor(options);
    const baseUrl = options.baseUrl ?? descriptor.baseUrl ?? '';
    if (!baseUrl) throw new Error('No base URL provided');

    const screenshotsDir = options.screenshotsDir ??
      path.join(process.cwd(), 'reports', `explore-${new Date().toISOString().replace(/[:.]/g, '-')}`);

    await this.browser.launch({
      headless: options.headless ?? true,
      screenshotsDir,
    });

    const explorationLog: ExplorationStep[] = [];
    const authBarriers: AuthBarrier[] = [];
    let status: 'complete' | 'partial' = 'complete';
    let error: string | undefined;

    try {
      // Navigate to entry point
      const entryUrl = baseUrl + (descriptor.entryPoint.path ?? '');
      console.log(`[Explorer] Navigating to ${entryUrl}`);
      await this.browser.navigate(entryUrl);
      await this.browser.waitForNetworkIdle();

      // Perform start action if specified
      let entryScreenName: string | null = null;
      if (descriptor.entryPoint.startAction) {
        console.log(`[Explorer] Entry action: ${descriptor.entryPoint.startAction}`);
        // Capture entry screen name before performing the action so we can skip it in the loop
        const entryScreen = await this.screenAnalyzer.captureScreen(this.browser);
        const entryMatch = this.screenAnalyzer.matchScreen(entryScreen, descriptor);
        entryScreenName = entryMatch.matched?.name ?? null;
        await this.browser.act(descriptor.entryPoint.startAction);
        await this.browser.waitForNetworkIdle(3000);
      }

      // Core exploration loop
      const result = await this.explorationLoop(descriptor, options, authBarriers, entryScreenName);
      explorationLog.push(...result.steps);
      if (result.error) {
        status = 'partial';
        error = result.error;
      }
    } catch (err) {
      status = 'partial';
      error = err instanceof Error ? err.message : String(err);
    } finally {
      await this.browser.close();
    }

    // Generate FlowStep[] from exploration log
    const generatedFlow = this.flowGenerator.generateFlowSteps(explorationLog, descriptor);
    const generatedConfig = this.flowGenerator.generateFullConfig(generatedFlow, descriptor, baseUrl);

    return {
      mode: 'explore',
      status,
      baseUrl,
      completedSteps: explorationLog.length,
      totalExpectedSteps: descriptor.screens.length,
      generatedFlow,
      generatedConfig,
      explorationLog,
      authBarriers,
      duration: Date.now() - start,
      screenshotsDir,
      error,
    };
  }

  // --- Verify Mode ---

  private async verifyMode(options: ExploreOptions): Promise<ExploreResult> {
    const start = Date.now();
    const configPath = options.existingConfigPath ??
      this.configRules.getRulesConfigPath(options.variant ?? DEFAULT_VARIANT);
    const rules = this.configRules.loadRules(configPath);

    if (isStateManagementRules(rules)) {
      throw new Error('Verify mode does not support state-management variant directly');
    }

    const testRules = rules as TestRules;
    const descriptor = this.loadDescriptor(options);
    const baseUrl = options.baseUrl ?? testRules.site.baseUrl;

    await this.browser.launch({ headless: options.headless ?? true });

    const explorationLog: ExplorationStep[] = [];
    const authBarriers: AuthBarrier[] = [];

    try {
      await this.browser.navigate(baseUrl);
      await this.browser.waitForNetworkIdle();

      // Walk through existing config steps, replaying each step's actions so we
      // actually navigate the flow before capturing the screen for that step.
      for (const step of testRules.flow) {
        console.log(`[Explorer:verify] Step ${step.step}: ${step.name}`);

        const screenBefore = await this.screenAnalyzer.captureScreen(this.browser);
        const match = this.screenAnalyzer.matchScreen(screenBefore, descriptor);
        console.log(`  Match: ${match.matched?.name ?? 'none'} (confidence: ${match.confidence.toFixed(2)})`);

        // Check for auth barriers
        const barrier = this.screenAnalyzer.classifyAuthBarrier(screenBefore, descriptor);
        if (barrier) {
          barrier.stepNumber = step.step;
          authBarriers.push(barrier);
          console.log(`  Auth barrier detected: ${barrier.type} — stopping verify`);
          explorationLog.push(this.createBarrierStep(step.step, step.name, screenBefore, barrier));
          break;
        }

        // Replay this step's actions against the live browser
        const performed: PerformedAction[] = [];
        for (const action of step.actions) {
          const instruction = action.value
            ? `${action.type} "${action.value}" in the ${action.label} field`
            : `${action.type} the ${action.label}`;
          try {
            await this.browser.act(instruction);
            await this.browser.waitForNetworkIdle(2000);
            performed.push({
              type: action.type,
              description: action.label ?? '',
              value: action.value,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`  Action failed: ${msg}`);
          }
        }

        const screenAfter = await this.screenAnalyzer.captureScreen(this.browser);
        const transition = await this.screenAnalyzer.detectTransition(screenBefore, screenAfter);

        explorationLog.push({
          stepNumber: step.step,
          screenName: step.name,
          screenBefore,
          screenAfter,
          actionsPerformed: performed,
          transition: {
            fromUrl: screenBefore.url,
            toUrl: screenAfter.url,
            urlChanged: transition.isNewScreen && screenBefore.url !== screenAfter.url,
            domSignificantChange: transition.isNewScreen,
            newElementsAppeared: [],
          },
        });

        // Wait for any post-action navigation to settle before next step
        await this.browser.waitForNetworkIdle(3000);
      }
    } finally {
      await this.browser.close();
    }

    // Generate flow from what we observed and diff against existing
    const generatedFlow = this.flowGenerator.generateFlowSteps(explorationLog, descriptor);
    const diff = this.diffMerge.computeDiff(generatedFlow, testRules.flow);

    return {
      mode: 'verify',
      status: 'complete',
      baseUrl,
      completedSteps: explorationLog.length,
      generatedFlow,
      explorationLog,
      authBarriers,
      diff,
      duration: Date.now() - start,
    };
  }

  // --- Update Mode ---

  private async updateMode(options: ExploreOptions): Promise<ExploreResult> {
    // First run explore to get the current state
    const exploreResult = await this.exploreMode(options);
    if (exploreResult.status === 'failed') return exploreResult;

    // Load existing config
    const configPath = options.existingConfigPath ??
      this.configRules.getRulesConfigPath(options.variant ?? DEFAULT_VARIANT);

    if (!fs.existsSync(configPath)) {
      // No existing config — just return explore result as-is
      return exploreResult;
    }

    const rules = this.configRules.loadRules(configPath);
    if (isStateManagementRules(rules)) {
      throw new Error('Update mode does not support state-management variant directly');
    }

    const testRules = rules as TestRules;

    // Compute diff
    const diff = this.diffMerge.computeDiff(exploreResult.generatedFlow, testRules.flow);

    // Merge with prefer_existing strategy
    const mergedFlow = this.diffMerge.mergeFlows(
      exploreResult.generatedFlow,
      testRules.flow,
      'prefer_existing'
    );

    // Build updated config preserving non-flow fields
    const updatedConfig: TestRules = {
      ...testRules,
      flow: mergedFlow,
    };

    // Backup existing config before writing
    this.healer.backupConfig(configPath, options.variant ?? DEFAULT_VARIANT);

    return {
      ...exploreResult,
      mode: 'update',
      generatedFlow: mergedFlow,
      generatedConfig: updatedConfig,
      diff,
    };
  }

  // --- Core Exploration Loop ---

  private async explorationLoop(
    descriptor: FlowDescriptor,
    options: ExploreOptions,
    authBarriers: AuthBarrier[],
    entryScreenName: string | null = null
  ): Promise<{ steps: ExplorationStep[]; error?: string }> {
    const steps: ExplorationStep[] = [];
    const visitedScreenKeys = new Map<string, number>();
    // Honour maxDepth from descriptor, then CLI option, then hard default
    const maxSteps = options.maxSteps ?? descriptor.explorationHints?.maxDepth ?? DEFAULT_MAX_STEPS;
    const avoidPatterns = descriptor.explorationHints?.avoidPatterns ?? [];
    let currentStepNum = 1;
    let entryScreenSkipped = false;
    let reachedLimit = false;

    while (currentStepNum <= maxSteps) {
      // 1. Capture current screen
      const screenBefore = await this.screenAnalyzer.captureScreen(this.browser);
      await this.browser.screenshot(`step-${currentStepNum}-before.png`);

      // 2. Check avoid-patterns — back off if we've wandered somewhere we shouldn't be
      if (avoidPatterns.some(pattern => screenBefore.url.includes(pattern))) {
        console.warn(`[Explorer] Avoid-pattern matched on URL "${screenBefore.url}" — navigating back`);
        try {
          await this.browser.getPage().goBack();
          await this.browser.waitForNetworkIdle(2000);
        } catch {
          return { steps, error: `Landed on avoided URL and could not go back: ${screenBefore.url}` };
        }
        continue;
      }

      // 3. Match against descriptor
      const match = this.screenAnalyzer.matchScreen(screenBefore, descriptor);
      const screenName = match.matched?.name ?? `Screen ${currentStepNum}`;
      console.log(`[Explorer] Step ${currentStepNum}: ${screenName} (confidence: ${match.confidence.toFixed(2)})`);

      // 4. Loop detection
      const screenKey = this.deriveScreenKey(screenBefore);
      const visitCount = (visitedScreenKeys.get(screenKey) ?? 0) + 1;
      visitedScreenKeys.set(screenKey, visitCount);

      if (visitCount >= LOOP_DETECTION_THRESHOLD) {
        console.warn(`[Explorer] Loop detected: screen "${screenName}" visited ${visitCount} times. Stopping.`);
        return { steps, error: `Loop detected at screen: ${screenName}` };
      }

      // 5. Check for auth barrier
      const barrier = this.screenAnalyzer.classifyAuthBarrier(screenBefore, descriptor);
      if (barrier) {
        barrier.stepNumber = currentStepNum;
        authBarriers.push(barrier);
        console.log(`[Explorer] Auth barrier: ${barrier.type} — ${barrier.description}`);

        const handled = await this.handleAuthBarrier(barrier, descriptor, options);
        if (!handled) {
          steps.push(this.createBarrierStep(currentStepNum, screenName, screenBefore, barrier));
          return { steps, error: `Stopped at auth barrier: ${barrier.type}` };
        }

        // Barrier was handled (e.g. OTP filled) — continue to next screen
        currentStepNum++;
        continue;
      }

      // 6. Check for completion
      if (match.matched?.phase === 'confirmation') {
        console.log(`[Explorer] Reached confirmation screen: ${screenName}`);
        steps.push({
          stepNumber: currentStepNum,
          screenName,
          screenBefore,
          screenAfter: screenBefore,
          actionsPerformed: [],
          transition: {
            fromUrl: screenBefore.url,
            toUrl: screenBefore.url,
            urlChanged: false,
            domSignificantChange: false,
            newElementsAppeared: [],
          },
        });
        break;
      }

      // 7. Skip entry screen on first encounter (entry action already performed before loop)
      if (entryScreenName && screenName === entryScreenName && !entryScreenSkipped) {
        console.log(`[Explorer] Skipping entry screen "${screenName}" actions (already performed by entryPoint.startAction)`);
        entryScreenSkipped = true;
        currentStepNum++;
        continue;
      }

      // 8. Determine and execute actions
      const performed = await this.executeScreenActions(screenBefore, descriptor, match.matched, options);

      // 9. Capture post-action screen
      await this.browser.waitForNetworkIdle(3000);
      const screenAfter = await this.screenAnalyzer.captureScreen(this.browser);
      await this.browser.screenshot(`step-${currentStepNum}-after.png`);

      // 10. Detect transition
      const transition = await this.screenAnalyzer.detectTransition(screenBefore, screenAfter);

      // 11. Record step
      steps.push({
        stepNumber: currentStepNum,
        screenName,
        screenBefore,
        screenAfter,
        actionsPerformed: performed,
        transition: {
          fromUrl: screenBefore.url,
          toUrl: screenAfter.url,
          urlChanged: transition.isNewScreen && screenBefore.url !== screenAfter.url,
          domSignificantChange: transition.isNewScreen,
          newElementsAppeared: [],
        },
      });

      console.log(`  Actions: ${performed.length}, Transition: ${transition.isNewScreen ? 'new screen' : 'same screen'}`);

      currentStepNum++;
    }

    // If we exited the while loop by exhausting steps (not via break on confirmation)
    if (currentStepNum > maxSteps) {
      reachedLimit = true;
    }

    return {
      steps,
      error: reachedLimit ? `Reached max steps limit (${maxSteps})` : undefined,
    };
  }

  // --- Action Execution ---

  private async executeScreenActions(
    screen: ScreenObservation,
    descriptor: FlowDescriptor,
    currentScreen: ReturnType<ScreenAnalyzerService['matchScreen']>['matched'],
    options: ExploreOptions
  ): Promise<PerformedAction[]> {
    const performed: PerformedAction[] = [];

    // Get prioritized actions
    const prioritized = await this.screenAnalyzer.prioritizeActions(
      screen, descriptor, currentScreen
    );

    if (prioritized.length === 0) {
      console.log('  No actions identified — trying autonomous exploration');
      try {
        await this.browser.act('Click the primary button or next step action on this page');
        performed.push({
          type: 'click' as ActionType,
          description: 'Autonomous: clicked primary action',
        });
      } catch (err) {
        console.warn('  Autonomous click failed:', err instanceof Error ? err.message : err);
      }
      return performed;
    }

    for (const p of prioritized) {
      const actionDesc = p.value
        ? `${p.action} "${p.value}" in the ${p.element.description} field`
        : `${p.action} the ${p.element.description}`;

      console.log(`  Action: ${actionDesc}`);

      try {
        // Resolve template for the value
        let resolvedValue = p.value;
        if (resolvedValue) {
          const template = this.templateResolver.resolveToTemplate(
            resolvedValue,
            p.element.description,
            descriptor.templateMappings,
            p.element.inputType
          );

          // If template was resolved, we still need a real value for execution
          if (template !== resolvedValue && template.startsWith('{{')) {
            // Use the real value for execution but record the template
            performed.push({
              type: p.action as ActionType,
              description: p.element.description,
              element: p.element,
              value: resolvedValue,
              templateVariable: template,
            });

            await this.browser.act(actionDesc);
            await this.browser.waitForNetworkIdle(2000);
            continue;
          }
        }

        await this.browser.act(actionDesc);
        await this.browser.waitForNetworkIdle(2000);

        performed.push({
          type: p.action as ActionType,
          description: p.element.description,
          element: p.element,
          value: resolvedValue,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`  Action failed: ${errMsg}`);
        // Try a retry with simpler instruction
        try {
          await this.browser.act(`Click ${p.element.text ?? p.element.description}`);
          performed.push({
            type: 'click' as ActionType,
            description: `Retry: ${p.element.description}`,
            element: p.element,
          });
        } catch {
          // Skip this action
          console.warn(`  Retry also failed — skipping`);
        }
      }
    }

    return performed;
  }

  // --- Auth Barrier Handling ---

  private async handleAuthBarrier(
    barrier: AuthBarrier,
    descriptor: FlowDescriptor,
    _options: ExploreOptions
  ): Promise<boolean> {
    const strategy = descriptor.authConfig.strategy;

    if (barrier.type === 'otp') {
      if (strategy === 'use_test_credentials') {
        const testOtp = process.env.TEST_OTP;
        if (testOtp) {
          console.log('[Explorer] Using test OTP from environment');
          await this.browser.act(`Fill ${testOtp} in the OTP field`);
          await this.browser.waitForNetworkIdle(3000);
          return true;
        }
        // Strategy requires test credentials but TEST_OTP is not set
        console.warn(
          '[Explorer] Strategy is "use_test_credentials" but TEST_OTP env var is not set. ' +
          'Set TEST_OTP in your .env file to auto-fill OTP. Stopping at barrier.'
        );
        return false;
      }

      if (strategy === 'pause_at_otp') {
        console.log('[Explorer] OTP barrier — recording step with template and stopping');
        return false;
      }

      if (strategy === 'skip_auth') {
        console.log('[Explorer] Skipping auth barrier as per descriptor strategy');
        return false;
      }

      // Unknown strategy — default to stopping
      console.warn(`[Explorer] Unknown auth strategy "${strategy}" for OTP barrier — stopping`);
      return false;
    }

    if (barrier.type === 'captcha') {
      console.log('[Explorer] CAPTCHA detected — cannot proceed automatically');
      return false;
    }

    // Unknown barrier type
    console.warn(`[Explorer] Unknown auth barrier type "${barrier.type}" — stopping`);
    return false;
  }

  // --- Helpers ---

  private createBarrierStep(
    stepNumber: number,
    screenName: string,
    screen: ScreenObservation,
    barrier: AuthBarrier
  ): ExplorationStep {
    return {
      stepNumber,
      screenName,
      screenBefore: screen,
      screenAfter: screen,
      actionsPerformed: [{
        type: 'fill' as ActionType,
        description: `${barrier.type} input`,
        value: barrier.type === 'otp' ? '{{prompt.otp}}' : '',
        templateVariable: barrier.type === 'otp' ? '{{prompt.otp}}' : undefined,
      }],
      transition: {
        fromUrl: screen.url,
        toUrl: screen.url,
        urlChanged: false,
        domSignificantChange: false,
        newElementsAppeared: [],
      },
    };
  }

  private deriveScreenKey(screen: ScreenObservation): string {
    try {
      const url = new URL(screen.url);
      const headings = screen.html
        .match(/<(?:h[1-4]|legend|label)[^>]*>([\s\S]*?)<\/(?:h[1-4]|legend|label)>/gi)
        ?.map(h => h.replace(/<[^>]+>/g, '').trim().toLowerCase())
        .filter(t => t.length > 2 && t.length < 50)
        .slice(0, 3)
        .join('|') ?? '';
      const inputSignature = screen.interactableElements
        .map(e => e.description)
        .slice(0, 3)
        .join('|');
      return `${url.pathname}::${headings}::${inputSignature}`;
    } catch {
      return screen.url;
    }
  }

  private loadDescriptor(options: ExploreOptions): FlowDescriptor {
    let descriptorPath = options.descriptorPath;

    if (!descriptorPath && options.variant) {
      // Try to find descriptor by variant
      const candidates = [
        path.join(process.cwd(), 'config', 'flow-descriptors', `rupeek-lp2-${options.variant}.descriptor.json`),
        path.join(process.cwd(), 'config', 'flow-descriptors', `${options.variant}.descriptor.json`),
      ];
      descriptorPath = candidates.find(p => fs.existsSync(p));
    }

    if (!descriptorPath) {
      // Default to first descriptor found
      const descriptorsDir = path.join(process.cwd(), 'config', 'flow-descriptors');
      if (fs.existsSync(descriptorsDir)) {
        const files = fs.readdirSync(descriptorsDir).filter(f => f.endsWith('.descriptor.json'));
        if (files.length > 0) {
          descriptorPath = path.join(descriptorsDir, files[0]);
        }
      }
    }

    if (!descriptorPath || !fs.existsSync(descriptorPath)) {
      throw new Error(
        `Flow descriptor not found. Create one at config/flow-descriptors/<name>.descriptor.json or pass --descriptor <path>`
      );
    }

    console.log(`[Explorer] Using descriptor: ${descriptorPath}`);
    const raw = fs.readFileSync(descriptorPath, 'utf-8');
    const parsed = JSON.parse(raw) as FlowDescriptor;

    // Resolve env templates in baseUrl
    if (parsed.baseUrl?.includes('{{env.')) {
      parsed.baseUrl = parsed.baseUrl.replace(/\{\{env\.(\w+)\}\}/g, (_, key: string) => process.env[key] ?? '');
    }

    return parsed;
  }

  private getOutputConfigPath(options: ExploreOptions): string {
    if (options.existingConfigPath) return options.existingConfigPath;
    const variant = options.variant ?? 'fresh';
    return path.join(process.cwd(), 'config', `test-rules-${variant}.generated.json`);
  }

  private parseCliArgs(argv: string[]): ExploreOptions {
    const getArg = (flag: string): string | undefined => {
      const idx = argv.indexOf(flag);
      return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
    };

    const hasFlag = (flag: string): boolean => argv.includes(flag);

    const mode = (getArg('--mode') ?? 'explore') as ExploreMode;
    const variant = getArg('--variant') as FlowVariant | undefined;
    const baseUrl = getArg('--base-url');
    const descriptorPath = getArg('--descriptor');
    // Cache result to avoid calling getArg twice
    const maxStepsRaw = getArg('--max-steps');
    const maxSteps = maxStepsRaw ? parseInt(maxStepsRaw, 10) : undefined;
    const headless = hasFlag('--no-headless') ? false : process.env.HEADLESS !== 'false';

    return {
      mode,
      variant,
      baseUrl,
      descriptorPath,
      maxSteps,
      headless,
    };
  }
}
