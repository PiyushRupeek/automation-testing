import {
  ActionType,
  Credentials,
  FlowStep,
  FlowVariant,
  TestAction,
  TestAssertion,
  TestRules,
} from '../../../common/types';
import { FlowDescriptor } from './flow-descriptor.types';

export type ExploreMode = 'explore' | 'verify' | 'update';

export interface ExploreOptions {
  mode: ExploreMode;
  variant?: FlowVariant;
  baseUrl?: string;
  descriptorPath?: string;
  existingConfigPath?: string;
  maxSteps?: number;
  headless?: boolean;
  screenshotsDir?: string;
  credentials?: Partial<Credentials>;
  timeout?: number;
}

export interface ObservedElement {
  description: string;
  selector: string;
  tagName: string;
  role?: string;
  text?: string;
  placeholder?: string;
  inputType?: string;
  isVisible: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ScreenObservation {
  url: string;
  title: string;
  screenshot: string;
  html: string;
  interactableElements: ObservedElement[];
  extractedData: Record<string, unknown>;
  timestamp: string;
}

export interface ScreenTransition {
  fromUrl: string;
  toUrl: string;
  trigger?: ObservedElement;
  urlChanged: boolean;
  domSignificantChange: boolean;
  newElementsAppeared: string[];
}

export interface PerformedAction {
  type: ActionType;
  description: string;
  element?: ObservedElement;
  value?: string;
  templateVariable?: string;
}

export interface ExplorationStep {
  stepNumber: number;
  screenName: string;
  screenBefore: ScreenObservation;
  screenAfter: ScreenObservation;
  actionsPerformed: PerformedAction[];
  transition: ScreenTransition;
}

export type AuthBarrierType = 'otp' | 'captcha' | 'file_upload' | 'unknown';
export type AuthResumeStrategy = 'pause' | 'skip' | 'mock';

export interface AuthBarrier {
  stepNumber: number;
  type: AuthBarrierType;
  description: string;
  resumeStrategy: AuthResumeStrategy;
}

export interface ExploreResult {
  mode: ExploreMode;
  status: 'complete' | 'partial' | 'failed';
  baseUrl: string;
  completedSteps: number;
  totalExpectedSteps?: number;
  generatedFlow: FlowStep[];
  generatedConfig?: TestRules;
  explorationLog: ExplorationStep[];
  authBarriers: AuthBarrier[];
  diff?: FlowDiff;
  duration: number;
  screenshotsDir?: string;
  error?: string;
}

export interface StepDiff {
  stepNumber: number;
  name: string;
  addedActions: TestAction[];
  removedActions: TestAction[];
  changedActions: { index: number; before: TestAction; after: TestAction }[];
  addedAssertions: TestAssertion[];
  removedAssertions: TestAssertion[];
  changedAssertions: { index: number; before: TestAssertion; after: TestAssertion }[];
}

export interface FlowDiff {
  addedSteps: FlowStep[];
  removedSteps: FlowStep[];
  changedSteps: StepDiff[];
  unchangedStepNumbers: number[];
}

export interface ExploreProgressEvent {
  type:
    | 'explore_started'
    | 'screen_captured'
    | 'action_performed'
    | 'step_completed'
    | 'auth_barrier'
    | 'explore_completed'
    | 'explore_failed'
    | 'otp_required'
    | 'heartbeat';
  explorationId?: string;
  timestamp: string;
  stepNumber?: number;
  screenName?: string;
  actionDescription?: string;
  error?: string;
  result?: ExploreResult;
}
