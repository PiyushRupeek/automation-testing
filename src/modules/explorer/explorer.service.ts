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
      if (descriptor.entryPoint.startAction) {
        console.log(`[Explorer] Entry action: ${descriptor.entryPoint.startAction}`);
        await this.browser.act(descriptor.entryPoint.startAction);
        await this.browser.waitForNetworkIdle(3000);
      }

      // Core exploration loop
      const result = await this.explorationLoop(descriptor, options, authBarriers);
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
      this.configRules.getRulesConfigPath(options.variant ?? 'fresh');
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

      // Walk through existing config steps and verify each
      for (const step of testRules.flow) {
        console.log(`[Explorer:verify] Checking step ${step.step}: ${step.name}`);
        const screen = await this.screenAnalyzer.captureScreen(this.browser);
        const match = this.screenAnalyzer.matchScreen(screen, descriptor);

        explorationLog.push({
          stepNumber: step.step,
          screenName: step.name,
          screenBefore: screen,
          screenAfter: screen,
          actionsPerformed: [],
          transition: {
            fromUrl: screen.url,
            toUrl: screen.url,
            urlChanged: false,
            domSignificantChange: false,
            newElementsAppeared: [],
          },
        });

        console.log(`  Match: ${match.matched?.name ?? 'none'} (confidence: ${match.confidence.toFixed(2)})`);
      }
    } finally {
      await this.browser.close();
    }

    // Generate flow from what we observed
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
      this.configRules.getRulesConfigPath(options.variant ?? 'fresh');

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
    this.healer.backupConfig(configPath, options.variant ?? 'fresh');

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
    authBarriers: AuthBarrier[]
  ): Promise<{ steps: ExplorationStep[]; error?: string }> {
    const steps: ExplorationStep[] = [];
    const visitedScreenKeys = new Map<string, number>();
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    let currentStepNum = 1;

    while (currentStepNum <= maxSteps) {
      // 1. Capture current screen
      const screenBefore = await this.screenAnalyzer.captureScreen(this.browser);
      await this.browser.screenshot(`step-${currentStepNum}-before.png`);

      // 2. Match against descriptor
      const match = this.screenAnalyzer.matchScreen(screenBefore, descriptor);
      const screenName = match.matched?.name ?? `Screen ${currentStepNum}`;
      console.log(`[Explorer] Step ${currentStepNum}: ${screenName} (confidence: ${match.confidence.toFixed(2)})`);

      // 3. Loop detection
      const screenKey = this.deriveScreenKey(screenBefore);
      const visitCount = (visitedScreenKeys.get(screenKey) ?? 0) + 1;
      visitedScreenKeys.set(screenKey, visitCount);

      if (visitCount >= LOOP_DETECTION_THRESHOLD) {
        console.warn(`[Explorer] Loop detected: screen "${screenName}" visited ${visitCount} times. Stopping.`);
        return { steps, error: `Loop detected at screen: ${screenName}` };
      }

      // 4. Check for auth barrier
      const barrier = this.screenAnalyzer.classifyAuthBarrier(screenBefore, descriptor);
      if (barrier) {
        barrier.stepNumber = currentStepNum;
        authBarriers.push(barrier);
        console.log(`[Explorer] Auth barrier: ${barrier.type} — ${barrier.description}`);

        const handled = await this.handleAuthBarrier(barrier, descriptor, options);
        if (!handled) {
          // Record the barrier step and continue
          steps.push(this.createBarrierStep(currentStepNum, screenName, screenBefore, barrier));
          return { steps, error: `Stopped at auth barrier: ${barrier.type}` };
        }

        // After handling barrier, continue to next iteration
        currentStepNum++;
        continue;
      }

      // 5. Check for completion
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

      // 6. Determine and execute actions
      const performed = await this.executeScreenActions(screenBefore, descriptor, match.matched, options);

      // 7. Capture post-action screen
      await this.browser.waitForNetworkIdle(3000);
      const screenAfter = await this.screenAnalyzer.captureScreen(this.browser);
      await this.browser.screenshot(`step-${currentStepNum}-after.png`);

      // 8. Detect transition
      const transition = await this.screenAnalyzer.detectTransition(screenBefore, screenAfter);

      // 9. Record step
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

    if (currentStepNum > maxSteps) {
      return { steps, error: `Reached max steps limit (${maxSteps})` };
    }

    return { steps };
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
    options: ExploreOptions
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
      }

      if (strategy === 'pause_at_otp') {
        console.log('[Explorer] OTP barrier — recording step with template and stopping');
        return false;
      }

      if (strategy === 'skip_auth') {
        console.log('[Explorer] Skipping auth barrier');
        return false;
      }
    }

    if (barrier.type === 'captcha') {
      console.log('[Explorer] CAPTCHA detected — cannot proceed automatically');
      return false;
    }

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
        .match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)
        ?.map(h => h.replace(/<[^>]+>/g, '').trim().toLowerCase())
        .slice(0, 3)
        .join('|') ?? '';
      return `${url.pathname}::${headings}`;
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
    const maxSteps = getArg('--max-steps') ? parseInt(getArg('--max-steps')!, 10) : undefined;
    const headless = hasFlag('--no-headless') ? false : true;

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
