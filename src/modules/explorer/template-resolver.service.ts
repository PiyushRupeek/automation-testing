import { Injectable } from '@nestjs/common';
import { Credentials, FlowStep } from '../../common/types';
import { TemplateMappingRule } from './types/flow-descriptor.types';

@Injectable()
export class TemplateResolverService {
  resolveToTemplate(
    value: string,
    fieldDescription: string,
    mappingRules: TemplateMappingRule[],
    inputType?: string
  ): string {
    if (!value) return value;

    // Pass 1: Check against known env var values
    const envMatch = this.matchEnvValue(value);
    if (envMatch) return envMatch;

    // Pass 2: Check custom mapping rules from descriptor
    for (const rule of mappingRules) {
      const hint = rule.fieldHint.toLowerCase();
      const desc = fieldDescription.toLowerCase();

      if (desc.includes(hint)) return rule.templateVariable;
      if (rule.inputType && inputType === rule.inputType) return rule.templateVariable;
    }

    // Pass 3: Heuristic matching by field description
    const heuristic = this.heuristicMatch(fieldDescription, inputType);
    if (heuristic) return heuristic;

    return value;
  }

  templatizeFlow(
    flow: FlowStep[],
    rules: TemplateMappingRule[],
    knownCredentials?: Partial<Credentials>
  ): FlowStep[] {
    return flow.map(step => ({
      ...step,
      actions: step.actions.map(action => {
        if (!action.value) return action;

        // Check if value matches known credentials
        if (knownCredentials) {
          const credMatch = this.matchCredential(action.value, knownCredentials);
          if (credMatch) {
            return { ...action, value: credMatch };
          }
        }

        const description = action.label ?? '';
        const template = this.resolveToTemplate(action.value, description, rules);
        if (template !== action.value) {
          return { ...action, value: template };
        }

        return action;
      }),
    }));
  }

  private matchEnvValue(value: string): string | null {
    const envMappings: [string, string][] = [
      ['TEST_MOBILE', '{{credentials.mobile}}'],
      ['TEST_OTP', '{{prompt.otp}}'],
      ['TEST_PAN', '{{credentials.pan}}'],
      ['TEST_PINCODE', '{{loanDetails.pincode}}'],
    ];

    for (const [envKey, template] of envMappings) {
      const envVal = process.env[envKey];
      if (envVal && value === envVal) return template;
    }

    return null;
  }

  private matchCredential(value: string, credentials: Partial<Credentials>): string | null {
    if (credentials.mobile && value === credentials.mobile) return '{{credentials.mobile}}';
    if (credentials.mobileFresh && value === credentials.mobileFresh) return '{{credentials.mobileFresh}}';
    if (credentials.mobileTakeover && value === credentials.mobileTakeover) return '{{credentials.mobileTakeover}}';
    if (credentials.otp && value === credentials.otp) return '{{prompt.otp}}';
    if (credentials.pan && value === credentials.pan) return '{{credentials.pan}}';
    return null;
  }

  private heuristicMatch(fieldDescription: string, inputType?: string): string | null {
    const desc = fieldDescription.toLowerCase();

    // Mobile / phone
    if (
      desc.includes('mobile') ||
      desc.includes('phone') ||
      inputType === 'tel'
    ) {
      return '{{credentials.mobile}}';
    }

    // OTP
    if (desc.includes('otp') || desc.includes('verification code')) {
      return '{{prompt.otp}}';
    }

    // Pincode / postal
    if (
      desc.includes('pincode') ||
      desc.includes('pin code') ||
      desc.includes('zip') ||
      desc.includes('postal')
    ) {
      return '{{loanDetails.pincode}}';
    }

    // PAN
    if (desc.includes('pan')) {
      return '{{credentials.pan}}';
    }

    return null;
  }
}
