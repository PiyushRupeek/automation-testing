import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  ErrorCaseOverride,
  FlowVariant,
  RulesConfig,
  Scenario,
  StateManagementRules,
  TestRules,
} from '../../common/types';

export const SPECIAL_OVERRIDE_KEYS = new Set([
  'uploadFile',
  'uncheckConsent',
  'clearCookies',
  'useEmergencySlot',
]);

const SPECIAL_TEMPLATE_PREFIXES = ['prompt.'];

@Injectable()
export class ConfigRulesService {
  parseVariantFromArgv(argv: string[]): FlowVariant {
    const idx = argv.indexOf('--variant');
    if (idx !== -1 && argv[idx + 1]) {
      const v = argv[idx + 1];
      if (v === 'fresh' || v === 'takeover' || v === 'state-management') return v;
    }
    const envVariant = process.env.TEST_VARIANT;
    if (envVariant === 'fresh' || envVariant === 'takeover' || envVariant === 'state-management') {
      return envVariant;
    }
    return 'fresh';
  }

  getRulesConfigPath(variant: FlowVariant): string {
    return path.join(process.cwd(), 'config', `test-rules-${variant}.config.json`);
  }

  loadRules(configPath?: string, variant?: FlowVariant): RulesConfig {
    const filePath = configPath ?? this.getRulesConfigPath(variant ?? 'fresh');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as RulesConfig;
    return this.resolveEnvTemplates(parsed) as RulesConfig;
  }

  scenarioToTestRules(rules: StateManagementRules, scenario: Scenario): TestRules {
    const mobile =
      scenario.loanType === 'fresh'
        ? rules.credentials.mobileFresh ?? rules.credentials.mobile
        : rules.credentials.mobileTakeover ?? rules.credentials.mobile;

    return {
      flowVariant: 'state-management',
      site: rules.site,
      credentials: {
        ...rules.credentials,
        mobile: mobile ?? '',
      },
      loanDetails: rules.loanDetails,
      flow: scenario.flow,
      errorCases: rules.errorCases,
      schedule: rules.schedule,
      notifications: rules.notifications,
    };
  }

  resolveTemplates(rules: RulesConfig, overrides?: ErrorCaseOverride): RulesConfig {
    const cloned = this.deepClone(rules) as unknown as Record<string, unknown>;

    if (overrides) {
      for (const [dotPath, value] of Object.entries(overrides)) {
        if (SPECIAL_OVERRIDE_KEYS.has(dotPath)) continue;
        if (typeof value === 'string' || typeof value === 'number') {
          this.setNestedValue(cloned, dotPath, value);
        }
      }
    }

    const resolve = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return this.resolveTemplateString(value, cloned);
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

    return resolve(cloned) as unknown as RulesConfig;
  }

  getUploadFileOverride(overrides?: ErrorCaseOverride): string | undefined {
    if (!overrides?.uploadFile) return undefined;
    return String(overrides.uploadFile);
  }

  getErrorCaseOptions(overrides?: ErrorCaseOverride) {
    return {
      skipConsent: overrides?.uncheckConsent === true,
      clearCookiesBefore: Array.isArray(overrides?.clearCookies)
        ? (overrides.clearCookies as string[])
        : undefined,
      useEmergencySlot: overrides?.useEmergencySlot === true,
      uploadFileOverride: this.getUploadFileOverride(overrides),
    };
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
  }

  private resolveEnvTemplates(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replace(/\{\{env\.(\w+)\}\}/g, (_, key: string) => process.env[key] ?? '');
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveEnvTemplates(v));
    }
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.resolveEnvTemplates(v);
      }
      return result;
    }
    return value;
  }

  private getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
    return dotPath.split('.').reduce<unknown>((acc, key) => {
      if (acc !== null && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  private setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
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

  private resolveTemplateString(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
      const trimmed = path.trim();
      if (SPECIAL_TEMPLATE_PREFIXES.some((p) => trimmed.startsWith(p))) {
        return `{{${trimmed}}}`;
      }
      if (trimmed.startsWith('env.')) {
        const envVal = process.env[trimmed.slice(4)];
        return envVal ?? '';
      }
      const val = this.getNestedValue(data, trimmed);
      return val !== undefined && val !== null ? String(val) : '';
    });
  }
}
