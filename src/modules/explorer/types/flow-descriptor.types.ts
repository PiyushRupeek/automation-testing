export interface FlowDescriptor {
  product: string;
  version: string;
  description: string;
  baseUrl: string;

  entryPoint: {
    path: string;
    startAction?: string;
  };

  screens: ScreenDescriptor[];

  authConfig: AuthConfig;

  templateMappings: TemplateMappingRule[];

  explorationHints?: ExplorationHints;
}

export interface ScreenDescriptor {
  name: string;
  identifiedBy: ScreenIdentifier[];
  expectedActions?: string[];
  expectedAssertions?: string[];
  phase?: string;
  isAuthBarrier?: boolean;
  notes?: string;
}

export interface ScreenIdentifier {
  type: 'url_contains' | 'element_visible' | 'text_matches' | 'title_contains';
  value: string;
}

export type AuthStrategy = 'pause_at_otp' | 'use_test_credentials' | 'skip_auth' | 'interactive';

export interface AuthConfig {
  mobileField?: string;
  otpField?: string;
  strategy: AuthStrategy;
}

export interface TemplateMappingRule {
  fieldHint: string;
  templateVariable: string;
  inputType?: string;
}

export interface ExplorationHints {
  maxDepth?: number;
  preferredPath?: string[];
  avoidPatterns?: string[];
}
