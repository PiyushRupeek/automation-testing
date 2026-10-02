import { Injectable } from '@nestjs/common';
import {
  ActionType,
  FlowStep,
  TestAction,
  TestAssertion,
  TestRules,
} from '../../common/types';
import { FlowDescriptor, ScreenDescriptor } from './types/flow-descriptor.types';
import { ExplorationStep, PerformedAction } from './types/explorer.types';
import { TemplateResolverService } from './template-resolver.service';

@Injectable()
export class FlowGeneratorService {
  constructor(private readonly templateResolver: TemplateResolverService) {}

  generateFlowSteps(
    explorationLog: ExplorationStep[],
    descriptor: FlowDescriptor
  ): FlowStep[] {
    const steps: FlowStep[] = [];

    for (const exploration of explorationLog) {
      const step = this.explorationToFlowStep(exploration, descriptor);
      steps.push(step);
    }

    // Templatize all values
    return this.templateResolver.templatizeFlow(steps, descriptor.templateMappings);
  }

  generateFullConfig(
    flow: FlowStep[],
    descriptor: FlowDescriptor,
    baseUrl: string
  ): TestRules {
    return {
      site: {
        baseUrl,
        name: descriptor.product,
        timeout: 30000,
      },
      credentials: {
        mobile: '{{env.TEST_MOBILE}}',
        otp: '{{env.TEST_OTP}}',
        pan: '{{env.TEST_PAN}}',
      },
      loanDetails: {
        amount: 0,
        goldWeight: 0,
        purity: '',
        purpose: '',
        pincode: '{{env.TEST_PINCODE}}',
      },
      flow,
      errorCases: [],
      schedule: '0 */6 * * *',
      notifications: {
        slackWebhook: '{{env.SLACK_WEBHOOK}}',
        email: '{{env.ALERT_EMAIL}}',
      },
    };
  }

  private explorationToFlowStep(
    exploration: ExplorationStep,
    descriptor: FlowDescriptor
  ): FlowStep {
    const matchedScreen = this.findMatchedScreen(exploration, descriptor);
    const actions = this.generateActions(exploration.actionsPerformed);
    const assertions = this.generateAssertions(exploration, matchedScreen, descriptor);

    // Determine URL if it changed
    let url: string | undefined;
    if (exploration.transition.urlChanged) {
      try {
        const afterUrl = new URL(exploration.screenAfter.url);
        url = afterUrl.pathname + afterUrl.search;
      } catch {
        // Ignore invalid URL
      }
    }

    return {
      step: exploration.stepNumber,
      name: exploration.screenName || matchedScreen?.name || `Step ${exploration.stepNumber}`,
      url,
      phase: matchedScreen?.phase,
      actions,
      assertions,
    };
  }

  private generateActions(performed: PerformedAction[]): TestAction[] {
    return performed.map(p => {
      const action: TestAction = {
        type: this.mapActionType(p.type),
        label: p.description,
      };

      if (p.value !== undefined) {
        action.value = p.templateVariable ?? p.value;
      }

      return action;
    });
  }

  private generateAssertions(
    exploration: ExplorationStep,
    matchedScreen: ScreenDescriptor | null,
    descriptor: FlowDescriptor
  ): TestAssertion[] {
    const assertions: TestAssertion[] = [];

    // URL-based assertion if URL changed
    if (exploration.transition.urlChanged) {
      try {
        const afterUrl = new URL(exploration.screenAfter.url);
        const pathSegment = afterUrl.pathname.split('/').filter(Boolean).pop();
        if (pathSegment) {
          assertions.push({
            type: 'url_contains',
            value: pathSegment,
          });
        }
      } catch {
        // Ignore
      }
    }

    // Use descriptor expected assertions if available
    if (matchedScreen?.expectedAssertions) {
      for (const expected of matchedScreen.expectedAssertions) {
        assertions.push({
          type: 'element_visible',
          label: expected,
        });
      }
    }

    // If no assertions generated, look for visible text on the after screen
    if (assertions.length === 0) {
      // Find the next screen in the descriptor to use as assertion target
      const nextScreen = this.findNextScreen(matchedScreen, descriptor);
      if (nextScreen) {
        for (const id of nextScreen.identifiedBy) {
          if (id.type === 'element_visible') {
            assertions.push({
              type: 'element_visible',
              label: id.value,
            });
            break;
          }
        }
      }
    }

    // Always add no_error_toast
    assertions.push({ type: 'no_error_toast' });

    return assertions;
  }

  private findMatchedScreen(
    exploration: ExplorationStep,
    descriptor: FlowDescriptor
  ): ScreenDescriptor | null {
    for (const screen of descriptor.screens) {
      let matched = false;
      for (const id of screen.identifiedBy) {
        switch (id.type) {
          case 'url_contains':
            if (exploration.screenBefore.url.includes(id.value)) matched = true;
            break;
          case 'element_visible':
            if (exploration.screenBefore.html.includes(id.value)) matched = true;
            break;
        }
        if (matched) break;
      }
      if (matched) return screen;
    }
    return null;
  }

  private findNextScreen(
    current: ScreenDescriptor | null,
    descriptor: FlowDescriptor
  ): ScreenDescriptor | null {
    if (!current) return null;
    const idx = descriptor.screens.indexOf(current);
    if (idx === -1 || idx >= descriptor.screens.length - 1) return null;
    return descriptor.screens[idx + 1];
  }

  private mapActionType(type: ActionType): ActionType {
    return type;
  }
}
