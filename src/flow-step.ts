import {
  evaluateAssertion,
  diagnoseFailure,
  loadRules,
  planStep,
  resolveTemplates,
} from './agent';
import { BrowserController, InvalidSelectorError } from './browser';
import {
  HealSession,
  backupConfig,
  getMaxHealAttempts,
  isAutoHealEnabled,
  isPatchSafe,
  persistFlowStepPatch,
} from './healer';
import { getOtpPromptDelayMs, isInteractiveOtpEnabled, promptForOtp } from './interactive';
import {
  ActionLog,
  AssertionLog,
  FlowStep,
  PlanStepContext,
  RecoveryPlan,
  StepResult,
  StepRunOptions,
  TestAction,
  TestAssertion,
  TestRules,
} from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForElementVisibleText(
  browser: BrowserController,
  label: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const needle = label.trim();
  if (!needle) return;
  while (Date.now() < deadline) {
    if ((await browser.getPageHTML()).includes(needle)) return;
    await sleep(500);
  }
}

async function waitForUrlContains(
  browser: BrowserController,
  value: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const needle = value.trim();
  if (!needle) return;
  while (Date.now() < deadline) {
    if (browser.getCurrentUrl().includes(needle)) return;
    await sleep(500);
  }
}

async function verifyAssertText(
  browser: BrowserController,
  action: TestAction,
  timeoutMs = 30000
): Promise<void> {
  const expected = action.value ?? '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await browser.getPageHTML()).includes(expected)) return;
    await sleep(500);
  }
  throw new Error(`Expected text not found on page: "${expected}"`);
}

function isOtpFillAction(action: TestAction): boolean {
  return action.type === 'fill' && action.label.toLowerCase().includes('otp');
}

async function resolveOtpValue(rules: TestRules): Promise<string> {
  if (!isInteractiveOtpEnabled()) {
    if (!rules.credentials.otp) {
      throw new Error('TEST_OTP is not set and INTERACTIVE_OTP is disabled.');
    }
    return rules.credentials.otp;
  }
  const delay = getOtpPromptDelayMs();
  if (delay > 0) await sleep(delay);
  // eslint-disable-next-line no-console
  console.log('Enter the OTP you received on your phone.');
  return promptForOtp(rules.credentials.mobile);
}

async function applyConfigPatchAndReload(
  healSession: HealSession,
  rules: TestRules,
  step: FlowStep,
  recovery: RecoveryPlan
): Promise<boolean> {
  if (
    !recovery.patch ||
    recovery.confidence !== 'high' ||
    !healSession.canPatchStep(step.step) ||
    !isPatchSafe(recovery.patch)
  ) {
    return false;
  }

  const backupPath = backupConfig(healSession.configPath, healSession.variant);
  persistFlowStepPatch(healSession.configPath, step.step, recovery.patch);
  healSession.recordPatch({
    step: step.step,
    backupPath,
    patch: recovery.patch,
    reason: recovery.reason,
  });

  Object.assign(rules, resolveTemplates(loadRules(healSession.configPath)));
  console.log(`  [HEAL] Patched config for step ${step.step}: ${recovery.reason}`);
  console.log(`  [HEAL] Backup: ${backupPath}`);
  return true;
}

async function executePlannedAction(
  browser: BrowserController,
  step: FlowStep,
  action: TestAction,
  rules: TestRules,
  options: StepRunOptions | undefined,
  planContext?: PlanStepContext,
  recoveryOverride?: RecoveryPlan
): Promise<string> {
  let filePath = action.file;
  if (action.type === 'upload' && options?.uploadFileOverride) {
    filePath = options.uploadFileOverride;
  }

  let otpValue: string | undefined;
  if (isOtpFillAction(action) && action.value) {
    const html = await browser.getPageHTML();
    if (!html.toLowerCase().includes('otp')) {
      throw new Error('OTP screen is not visible.');
    }
    if (action.value.includes('{{prompt.otp}}') || action.value.includes('{{credentials.otp}}')) {
      otpValue = await resolveOtpValue(rules);
    }
  }

  let planAction = action.type;
  if (options?.skipConsent && action.type === 'check') planAction = 'uncheck';

  if (recoveryOverride?.selector) {
    await browser.executeAction({
      selector: recoveryOverride.selector,
      action: recoveryOverride.action ?? planAction,
      value: otpValue ?? recoveryOverride.value ?? action.value,
      file: filePath,
    });
    return recoveryOverride.selector;
  }

  const plan = await planStep(
    step.name,
    { ...action, type: planAction, file: filePath, value: otpValue ?? action.value },
    await browser.getPageHTML(),
    browser.getCurrentUrl(),
    await browser.screenshotBase64(),
    planContext
  );

  await browser.executeAction({
    selector: plan.selector,
    action: plan.action,
    value: otpValue ?? plan.value,
    file: filePath,
  });

  return plan.selector;
}

async function healActionFailure(
  browser: BrowserController,
  step: FlowStep,
  rules: TestRules,
  healSession: HealSession,
  action: TestAction,
  actionIndex: number,
  errorMsg: string,
  failedSelector?: string
): Promise<{ recovered: boolean; skip: boolean; retryStep: boolean; plan: RecoveryPlan; retrySameAction?: boolean }> {
  const plan = await diagnoseFailure({
    step,
    context: 'action',
    action,
    actionIndex,
    error: errorMsg,
    failedSelector,
    pageHTML: await browser.getPageHTML(),
    currentUrl: browser.getCurrentUrl(),
    screenshotBase64: await browser.screenshotBase64(),
  });

  console.log(`  [HEAL] ${plan.type}: ${plan.reason}`);

  if (plan.type === 'patch_config') {
    const patched = await applyConfigPatchAndReload(healSession, rules, step, plan);
    if (patched) {
      healSession.recordAttempt({
        step: step.step,
        stepName: step.name,
        context: 'action',
        actionIndex,
        error: errorMsg,
        recovery: plan,
        outcome: 'patched',
        timestamp: new Date().toISOString(),
      });
      return { recovered: false, skip: false, retryStep: true, plan };
    }
  }

  if (plan.type === 'skip_action') {
    healSession.recordAttempt({
      step: step.step,
      stepName: step.name,
      context: 'action',
      actionIndex,
      error: errorMsg,
      recovery: plan,
      outcome: 'recovered',
      timestamp: new Date().toISOString(),
    });
    return { recovered: true, skip: true, retryStep: false, plan };
  }

  if (plan.type === 'wait_then_retry') {
    await sleep(plan.waitMs ?? 2000);
    healSession.recordAttempt({
      step: step.step,
      stepName: step.name,
      context: 'action',
      actionIndex,
      error: errorMsg,
      recovery: plan,
      outcome: 'recovered',
      timestamp: new Date().toISOString(),
    });
    return { recovered: false, skip: false, retryStep: false, plan, retrySameAction: true };
  }

  if (plan.type === 'retry' && plan.selector) {
    try {
      await browser.executeAction({
        selector: plan.selector,
        action: plan.action ?? action.type,
        value: plan.value ?? action.value,
        file: action.file,
      });
      healSession.recordAttempt({
        step: step.step,
        stepName: step.name,
        context: 'action',
        actionIndex,
        error: errorMsg,
        recovery: plan,
        outcome: 'recovered',
        timestamp: new Date().toISOString(),
      });
      return { recovered: true, skip: false, retryStep: false, plan };
    } catch {
      return { recovered: false, skip: false, retryStep: false, plan };
    }
  }

  healSession.recordAttempt({
    step: step.step,
    stepName: step.name,
    context: 'action',
    actionIndex,
    error: errorMsg,
    recovery: plan,
    outcome: 'failed',
    timestamp: new Date().toISOString(),
  });
  return { recovered: false, skip: false, retryStep: false, plan };
}

async function healAssertionFailure(
  browser: BrowserController,
  step: FlowStep,
  rules: TestRules,
  healSession: HealSession,
  assertionIndex: number,
  assertion: TestAssertion,
  errorMsg: string
): Promise<{ retryStep: boolean; plan: RecoveryPlan }> {
  const plan = await diagnoseFailure({
    step,
    context: 'assertion',
    assertion,
    assertionIndex,
    error: errorMsg,
    pageHTML: await browser.getPageHTML(),
    currentUrl: browser.getCurrentUrl(),
    screenshotBase64: await browser.screenshotBase64(),
  });

  console.log(`  [HEAL] ${plan.type}: ${plan.reason}`);

  if (plan.type === 'patch_config') {
    const patched = await applyConfigPatchAndReload(healSession, rules, step, plan);
    if (patched) {
      healSession.recordAttempt({
        step: step.step,
        stepName: step.name,
        context: 'assertion',
        assertionIndex,
        error: errorMsg,
        recovery: plan,
        outcome: 'patched',
        timestamp: new Date().toISOString(),
      });
      return { retryStep: true, plan };
    }
  }

  if (plan.type === 'wait_then_retry') {
    await sleep(plan.waitMs ?? 2000);
    return { retryStep: false, plan };
  }

  healSession.recordAttempt({
    step: step.step,
    stepName: step.name,
    context: 'assertion',
    assertionIndex,
    error: errorMsg,
    recovery: plan,
    outcome: 'failed',
    timestamp: new Date().toISOString(),
  });
  return { retryStep: false, plan };
}

export async function runFlowStepWithHeal(
  browser: BrowserController,
  step: FlowStep,
  rules: TestRules,
  options: StepRunOptions | undefined,
  healSession: HealSession | undefined,
  buildUrl: (baseUrl: string, stepUrl?: string) => string,
  shouldSkipActionFn: (action: TestAction, options?: StepRunOptions) => boolean,
  getEmergencySlotActionsFn: () => TestAction[]
): Promise<StepResult> {
  const start = Date.now();
  let currentStep = step;
  let skipActionsOnRetry = false;
  let actionsCompleted = false;

  for (let stepAttempt = 0; stepAttempt < 2; stepAttempt++) {
    const actions: ActionLog[] = [];
    const assertions: AssertionLog[] = [];
    let stepScreenshot: string | undefined;
    let stepError: string | undefined;
    let stepFailed = false;
    let retryStepFromPatch = false;
    const timeout = options?.timeout ?? rules.site.timeout;
    const maxHeal = getMaxHealAttempts();

    browser.clearConsoleErrors();

    if (options?.clearCookiesBefore?.length) {
      await browser.clearCookies(options.clearCookiesBefore);
    }

    if (currentStep.url) {
      const stepPath = currentStep.url.split('?')[0];
      if (!browser.getCurrentUrl().includes(stepPath)) {
        await browser.navigate(buildUrl(rules.site.baseUrl, currentStep.url), timeout);
      }
    }

    const stepActions = options?.useEmergencySlot
      ? getEmergencySlotActionsFn()
      : currentStep.actions;

    const shouldSkipActions = skipActionsOnRetry && stepAttempt > 0;

    if (shouldSkipActions) {
      for (const action of stepActions) {
        actions.push({
          label: action.label,
          type: action.type,
          status: 'pass',
          error: 'Skipped (config patch retry — page already advanced)',
        });
      }
    } else actionLoop: for (let i = 0; i < stepActions.length; i++) {
      const action = stepActions[i];

      if (shouldSkipActionFn(action, options)) {
        actions.push({ label: action.label, type: action.type, status: 'pass', error: 'Skipped (consent test)' });
        continue;
      }

      const actionLog: ActionLog = { label: action.label, type: action.type, status: 'pass' };
      let healAttempts = 0;
      let planContext: PlanStepContext | undefined;
      let lastSelector: string | undefined;

      while (true) {
        try {
          if (action.type === 'assert_text') {
            await verifyAssertText(browser, action, timeout);
          } else {
            lastSelector = await executePlannedAction(
              browser,
              currentStep,
              action,
              rules,
              options,
              planContext
            );
            actionLog.selector = lastSelector;
          }

          const screenshotPath = await browser.screenshot(`step-${currentStep.step}-action-${i + 1}.png`);
          actionLog.screenshot = screenshotPath;
          stepScreenshot = screenshotPath;
          actions.push(actionLog);
          continue actionLoop;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);

          if (err instanceof InvalidSelectorError && healAttempts < maxHeal) {
            healAttempts++;
            planContext = { priorError: errorMsg, failedSelector: lastSelector, avoidSelectors: [] };
            continue;
          }

          if (!isAutoHealEnabled() || !healSession || healAttempts >= maxHeal) {
            actionLog.status = 'fail';
            actionLog.error = errorMsg;
            stepFailed = true;
            stepError = errorMsg;
            try {
              stepScreenshot = await browser.screenshot(`step-${currentStep.step}-action-${i + 1}-fail.png`);
              actionLog.screenshot = stepScreenshot;
            } catch {
              // ignore
            }
            actions.push(actionLog);
            break actionLoop;
          }

          healAttempts++;
          const heal = await healActionFailure(
            browser,
            currentStep,
            rules,
            healSession,
            action,
            i,
            errorMsg,
            lastSelector
          );

          if (heal.retryStep) {
            currentStep = rules.flow.find((s) => s.step === currentStep.step) ?? currentStep;
            return runFlowStepWithHeal(
              browser,
              currentStep,
              rules,
              options,
              healSession,
              buildUrl,
              shouldSkipActionFn,
              getEmergencySlotActionsFn
            );
          }

          if (heal.retrySameAction || heal.plan.type === 'wait_then_retry') {
            continue;
          }

          if (heal.skip) {
            actionLog.status = 'pass';
            actionLog.error = `Skipped (healed): ${heal.plan.reason}`;
            actions.push(actionLog);
            continue actionLoop;
          }

          if (heal.recovered) {
            actionLog.selector = heal.plan.selector ?? lastSelector;
            const screenshotPath = await browser.screenshot(`step-${currentStep.step}-action-${i + 1}.png`);
            actionLog.screenshot = screenshotPath;
            stepScreenshot = screenshotPath;
            actions.push(actionLog);
            continue actionLoop;
          }

          actionLog.status = 'fail';
          actionLog.error = errorMsg;
          stepFailed = true;
          stepError = errorMsg;
          try {
            stepScreenshot = await browser.screenshot(`step-${currentStep.step}-action-${i + 1}-fail.png`);
            actionLog.screenshot = stepScreenshot;
          } catch {
            // ignore
          }
          actions.push(actionLog);
          break actionLoop;
        }
      }
    }

    actionsCompleted = !stepFailed;

    if (!stepFailed) {
      for (let j = 0; j < currentStep.assertions.length; j++) {
        const assertion = currentStep.assertions[j];
        let healAttempts = 0;

        while (true) {
          try {
            const assertionTimeout = options?.timeout ?? 30000;
            if (assertion.type === 'element_visible' && assertion.label) {
              await waitForElementVisibleText(browser, assertion.label, assertionTimeout);
            }
            if (assertion.type === 'url_contains' && assertion.value) {
              await waitForUrlContains(browser, assertion.value, assertionTimeout);
            }

            const result = await evaluateAssertion(
              assertion,
              await browser.getPageHTML(),
              browser.getCurrentUrl(),
              await browser.screenshotBase64()
            );

            assertions.push({
              type: assertion.type,
              label: assertion.label,
              value: assertion.value,
              pass: result.pass,
              reason: result.reason,
            });

            if (!result.pass) throw new Error(result.reason);
            break;
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);

            if (!isAutoHealEnabled() || !healSession || healAttempts >= maxHeal) {
              assertions.push({
                type: assertion.type,
                label: assertion.label,
                value: assertion.value,
                pass: false,
                reason,
              });
              stepFailed = true;
              stepError = reason;
              stepScreenshot = await browser.screenshot(`step-${currentStep.step}-assert-fail.png`);
              break;
            }

            healAttempts++;
            const heal = await healAssertionFailure(
              browser,
              currentStep,
              rules,
              healSession,
              j,
              assertion,
              reason
            );

            if (heal.retryStep && stepAttempt === 0) {
              retryStepFromPatch = true;
              skipActionsOnRetry = actionsCompleted;
              break;
            }

            if (heal.plan.type === 'wait_then_retry') continue;

            assertions.push({
              type: assertion.type,
              label: assertion.label,
              value: assertion.value,
              pass: false,
              reason,
            });
            stepFailed = true;
            stepError = reason;
            stepScreenshot = await browser.screenshot(`step-${currentStep.step}-assert-fail.png`);
            break;
          }
        }

        if (retryStepFromPatch) break;
        if (stepFailed) break;
      }
    }

    if (retryStepFromPatch && stepAttempt === 0) {
      currentStep = rules.flow.find((s) => s.step === currentStep.step) ?? currentStep;
      continue;
    }

    if (stepFailed && stepAttempt === 0 && healSession?.configPatches.some((p) => p.step === currentStep.step)) {
      currentStep = rules.flow.find((s) => s.step === currentStep.step) ?? currentStep;
      continue;
    }

    return {
      step: currentStep.step,
      name: currentStep.name,
      status: stepFailed ? 'fail' : 'pass',
      screenshot: stepScreenshot,
      error: stepError,
      duration: Date.now() - start,
      actions,
      assertions,
    };
  }

  return {
    step: currentStep.step,
    name: currentStep.name,
    status: 'fail',
    error: 'Step failed after config patch retry',
    duration: Date.now() - start,
    actions: [],
    assertions: [],
  };
}
