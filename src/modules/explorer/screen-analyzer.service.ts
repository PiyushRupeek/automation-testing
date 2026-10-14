import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL } from '../../common/constants';
import { FlowDescriptor, ScreenDescriptor } from './types/flow-descriptor.types';
import {
  AuthBarrier,
  ObservedElement,
  ScreenObservation,
  ScreenTransition,
} from './types/explorer.types';
import { StagehandBrowserAdapter } from './stagehand-browser.adapter';

const SCREEN_TRANSITION_SYSTEM = `You are a UI analysis expert. Given two screenshots of a web page (before and after an action), determine if the user has moved to a new logical screen/step in the user journey.

Rules:
1. Return ONLY raw JSON: { "isNewScreen": true|false, "confidence": 0.0-1.0, "reason": "one sentence" }
2. A new screen means the primary content area changed significantly — not just a loading state, dropdown open, or tooltip.
3. Modal overlays count as a new screen if they are a distinct step in the flow.
4. URL changes always indicate a new screen.
5. If only minor text changed (e.g., a counter updated, input filled), it is NOT a new screen.`;

const ACTION_PRIORITY_SYSTEM = `You are a UI automation expert. Given a list of interactable elements on a page and the expected actions for this screen, determine which elements should be interacted with and in what order.

Rules:
1. Return ONLY raw JSON array: [{ "elementIndex": 0, "action": "click|fill|select|upload|check", "value": "...", "reason": "one sentence" }]
2. Priority order: form inputs that need filling → primary CTA buttons → selection cards → secondary actions.
3. Skip navigation links, footer links, back buttons, and decorative elements.
4. For fill actions, suggest a reasonable test value based on the field type (phone: 10 digits, name: "Test User", email: "test@test.com", etc.)
5. If expected actions are provided, match them to the visible elements.`;

@Injectable()
export class ScreenAnalyzerService {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async captureScreen(browser: StagehandBrowserAdapter): Promise<ScreenObservation> {
    const [html, screenshot, title, elements] = await Promise.all([
      browser.getPageHTML(),
      browser.screenshotBase64(),
      browser.getTitle(),
      browser.observe(),
    ]);

    return {
      url: browser.getCurrentUrl(),
      title,
      screenshot,
      html: html.slice(0, 50000),
      interactableElements: elements,
      extractedData: {},
      timestamp: new Date().toISOString(),
    };
  }

  async detectTransition(
    before: ScreenObservation,
    after: ScreenObservation
  ): Promise<{ isNewScreen: boolean; confidence: number; reason: string }> {
    const beforePath = new URL(before.url).pathname;
    const afterPath = new URL(after.url).pathname;

    // Fast path: URL pathname changed
    if (beforePath !== afterPath) {
      return { isNewScreen: true, confidence: 1.0, reason: `URL changed from ${beforePath} to ${afterPath}` };
    }

    // SPA detection: compare visible headings/text
    const beforeHeadings = this.extractHeadings(before.html);
    const afterHeadings = this.extractHeadings(after.html);
    const headingOverlap = this.computeOverlap(beforeHeadings, afterHeadings);

    if (headingOverlap < 0.4) {
      return {
        isNewScreen: true,
        confidence: 0.85,
        reason: `DOM content shifted significantly (${Math.round((1 - headingOverlap) * 100)}% heading change)`,
      };
    }

    if (headingOverlap > 0.85) {
      return {
        isNewScreen: false,
        confidence: 0.9,
        reason: 'Page content is largely the same',
      };
    }

    // Ambiguous: use Claude vision to decide
    try {
      return await this.claudeTransitionCheck(before.screenshot, after.screenshot);
    } catch {
      // Fallback: moderate change, not sure
      return {
        isNewScreen: headingOverlap < 0.6,
        confidence: 0.5,
        reason: 'Ambiguous change — visual check unavailable',
      };
    }
  }

  matchScreen(
    observation: ScreenObservation,
    descriptor: FlowDescriptor
  ): { matched: ScreenDescriptor | null; confidence: number } {
    let bestMatch: ScreenDescriptor | null = null;
    let bestScore = 0;

    for (const screen of descriptor.screens) {
      let score = 0;
      let checks = 0;

      for (const id of screen.identifiedBy) {
        checks++;
        switch (id.type) {
          case 'url_contains':
            if (observation.url.includes(id.value)) score++;
            break;
          case 'element_visible':
            if (observation.html.includes(id.value)) score++;
            break;
          case 'text_matches':
            if (new RegExp(id.value, 'i').test(observation.html)) score++;
            break;
          case 'title_contains':
            if (observation.title.includes(id.value)) score++;
            break;
        }
      }

      const confidence = checks > 0 ? score / checks : 0;
      // Note on tie-breaking: when two screens share equal confidence, the
      // later-listed screen in the descriptor wins (>= condition). This is
      // intentional — overlays and post-action screens are listed later in the
      // descriptor and should take precedence over earlier base screens.
      if (confidence >= bestScore && confidence > 0) {
        bestScore = confidence;
        bestMatch = screen;
      }
    }

    return { matched: bestScore >= 0.5 ? bestMatch : null, confidence: bestScore };
  }

  classifyAuthBarrier(
    observation: ScreenObservation,
    descriptor?: FlowDescriptor
  ): AuthBarrier | null {
    // Check descriptor hint first
    if (descriptor) {
      const match = this.matchScreen(observation, descriptor);
      if (match.matched?.isAuthBarrier) {
        const isOtp = observation.html.toLowerCase().includes('otp');
        return {
          stepNumber: 0,
          type: isOtp ? 'otp' : 'unknown',
          description: `Auth barrier at screen: ${match.matched.name}`,
          resumeStrategy: 'pause',
        };
      }
    }

    const htmlLower = observation.html.toLowerCase();

    // OTP detection
    if (
      htmlLower.includes('enter otp') ||
      htmlLower.includes('verification code') ||
      htmlLower.includes('enter 4 digit') ||
      htmlLower.includes('enter 6 digit')
    ) {
      return {
        stepNumber: 0,
        type: 'otp',
        description: 'OTP verification screen detected',
        resumeStrategy: 'pause',
      };
    }

    // CAPTCHA detection
    if (htmlLower.includes('captcha') || htmlLower.includes('recaptcha')) {
      return {
        stepNumber: 0,
        type: 'captcha',
        description: 'CAPTCHA challenge detected',
        resumeStrategy: 'skip',
      };
    }

    return null;
  }

  async prioritizeActions(
    observation: ScreenObservation,
    descriptor: FlowDescriptor,
    currentScreen: ScreenDescriptor | null
  ): Promise<{ element: ObservedElement; action: string; value?: string; reason: string }[]> {
    const elements = observation.interactableElements;
    if (elements.length === 0) return [];

    const expectedActions = currentScreen?.expectedActions ?? [];

    const elementSummary = elements.map((el, i) => ({
      index: i,
      description: el.description,
      tagName: el.tagName,
      role: el.role,
      text: el.text?.slice(0, 100),
      placeholder: el.placeholder,
      inputType: el.inputType,
    }));

    try {
      const response = await this.getClient().messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: ACTION_PRIORITY_SYSTEM,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            currentUrl: observation.url,
            expectedActions,
            elements: elementSummary,
          }),
        }],
      });

      const text = response.content.find(b => b.type === 'text');
      const parsed = JSON.parse(
        (text?.type === 'text' ? text.text : '[]').replace(/```json?\s*/g, '').replace(/```/g, '').trim()
      );

      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((p: any) => p.elementIndex >= 0 && p.elementIndex < elements.length)
        .map((p: any) => ({
          element: elements[p.elementIndex],
          action: p.action ?? 'click',
          value: p.value,
          reason: p.reason ?? '',
        }));
    } catch (err) {
      console.warn('[ScreenAnalyzer] Failed to prioritize actions via Claude:', err);
      return this.fallbackPrioritize(elements);
    }
  }

  private fallbackPrioritize(
    elements: ObservedElement[]
  ): { element: ObservedElement; action: string; value?: string; reason: string }[] {
    const results: { element: ObservedElement; action: string; value?: string; reason: string }[] = [];

    // Inputs first — Playwright always returns lowercase tag names, so only check 'input'
    for (const el of elements) {
      if (el.tagName === 'input' || el.role === 'textbox') {
        // Skip recording a value here — Claude will supply values when prioritizing;
        // fallback inputs are recorded without values to avoid empty strings in config
        results.push({ element: el, action: 'fill', reason: 'Input field (fallback)' });
      }
    }

    // Then buttons / CTAs
    for (const el of elements) {
      const desc = (el.description + ' ' + (el.text ?? '')).toLowerCase();
      if (
        el.role === 'button' ||
        el.tagName === 'button' ||
        desc.includes('continue') ||
        desc.includes('submit') ||
        desc.includes('proceed') ||
        desc.includes('get started')
      ) {
        results.push({ element: el, action: 'click', reason: 'Button/CTA (fallback)' });
      }
    }

    return results;
  }

  private extractHeadings(html: string): string[] {
    const headings: string[] = [];
    const regex = /<(?:h[1-6]|title|label|legend)[^>]*>([\s\S]*?)<\/(?:h[1-6]|title|label|legend)>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text) headings.push(text.toLowerCase());
    }
    return headings;
  }

  private computeOverlap(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = new Set([...a, ...b]).size;
    return union > 0 ? intersection / union : 0;
  }

  private async claudeTransitionCheck(
    beforeScreenshot: string,
    afterScreenshot: string
  ): Promise<{ isNewScreen: boolean; confidence: number; reason: string }> {
    const response = await this.getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 256,
      temperature: 0,
      system: SCREEN_TRANSITION_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Before action:' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: beforeScreenshot } },
          { type: 'text', text: 'After action:' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: afterScreenshot } },
          { type: 'text', text: 'Did the screen content significantly change? Is this a new step in the user journey?' },
        ],
      }],
    });

    const text = response.content.find(b => b.type === 'text');
    const raw = (text?.type === 'text' ? text.text : '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { isNewScreen: false, confidence: 0.5, reason: 'Could not parse Claude response' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isNewScreen: parsed.isNewScreen ?? false,
      confidence: parsed.confidence ?? 0.5,
      reason: parsed.reason ?? 'Unknown',
    };
  }
}
