import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';
import { z } from 'zod';
import { ObservedElement } from './types/explorer.types';
import { ClaudeCustomLLMClient } from './claude-llm-client';

@Injectable()
export class StagehandBrowserAdapter {
  private stagehand: any = null;
  private screenshotsDir = '';

  async launch(options: {
    headless?: boolean;
    baseUrl?: string;
    screenshotsDir?: string;
  }): Promise<void> {
    // Dynamic import since Stagehand is an ESM module
    const { Stagehand } = await import('@browserbasehq/stagehand');

    this.screenshotsDir = options.screenshotsDir ?? path.join(process.cwd(), 'reports', 'explore-screenshots');
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Please set ANTHROPIC_API_KEY in your .env file or environment before running Stagehand exploration.'
      );
    }
    const llmClient = new ClaudeCustomLLMClient(apiKey);

    this.stagehand = new Stagehand({
      env: 'LOCAL',
      llmClient,
      headless: options.headless ?? true,
      enableCaching: false,
    });

    await this.stagehand.init();
  }

  async close(): Promise<void> {
    if (this.stagehand) {
      await this.stagehand.close();
      this.stagehand = null;
    }
  }

  getPage(): Page {
    if (!this.stagehand) {
      throw new Error('Stagehand not initialized. Call launch() first.');
    }
    return this.stagehand.page;
  }

  async act(instruction: string): Promise<void> {
    if (!this.stagehand) throw new Error('Stagehand not initialized');
    await this.stagehand.page.act(instruction);
  }

  async observe(): Promise<ObservedElement[]> {
    if (!this.stagehand) throw new Error('Stagehand not initialized');
    const observations = await this.stagehand.page.observe();

    return observations.map((obs: any) => ({
      description: obs.description ?? '',
      selector: obs.selector ?? '',
      tagName: obs.tagName ?? obs.locator?.toString() ?? '',
      role: obs.role,
      text: obs.text,
      placeholder: obs.placeholder,
      inputType: obs.inputType,
      isVisible: true,
      boundingBox: obs.boundingBox,
    }));
  }

  async extract<T>(schema: z.ZodSchema<T>, instruction: string): Promise<T> {
    if (!this.stagehand) throw new Error('Stagehand not initialized');
    return this.stagehand.page.extract({
      instruction,
      schema,
    });
  }

  async navigate(url: string, timeout = 30000): Promise<void> {
    const page = this.getPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout });
  }

  async waitForNetworkIdle(timeout = 5000): Promise<void> {
    const page = this.getPage();
    try {
      await page.waitForLoadState('networkidle', { timeout });
    } catch {
      // Timeout is acceptable — page may already be idle
    }
  }

  getCurrentUrl(): string {
    return this.getPage().url();
  }

  async getPageHTML(): Promise<string> {
    return this.getPage().content();
  }

  async screenshot(filename: string): Promise<string> {
    const filePath = path.join(this.screenshotsDir, filename);
    await this.getPage().screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  async screenshotBase64(): Promise<string> {
    const buffer = await this.getPage().screenshot({ fullPage: false });
    return buffer.toString('base64');
  }

  async getTitle(): Promise<string> {
    return this.getPage().title();
  }

  async fillOtpAndSubmit(otp: string): Promise<boolean> {
    const page = this.getPage();
    try {
      // 1. Locate the OTP inputs
      // Rupeek LP2 has .box-0-2-97:first-child input or div[class*="box"] input
      const firstInput = page
        .locator(
          '.box-0-2-97:first-child input, div[class*="box"] input, input[type="tel"], input[type="number"], input[autocomplete="one-time-code"]'
        )
        .first();

      const count = await firstInput.count();
      if (count > 0) {
        console.log('[Stagehand] Focusing first OTP input box and typing code');
        await firstInput.click({ force: true }).catch(() => {});
        await firstInput.fill('');
        await firstInput.pressSequentially(otp, { delay: 100 });
      }

      await page.waitForTimeout(500);

      // 2. Check if individual digit boxes exist and remaining boxes are still empty
      const allBoxes = page.locator('div[class*="box"] input, input[type="tel"], input[type="number"]');
      const boxCount = await allBoxes.count();
      if (boxCount >= 4) {
        for (let i = 0; i < 4 && i < otp.length; i++) {
          const val = await allBoxes.nth(i).inputValue().catch(() => '');
          if (!val) {
            await allBoxes.nth(i).focus().catch(() => {});
            await allBoxes.nth(i).fill(otp[i]).catch(() => {});
          }
        }
      }

      await page.waitForTimeout(500);

      // 3. Click Continue or Verify button
      const continueBtn = page
        .locator('button:has-text("Continue"), button:has-text("Verify"), .ctaBtn-0-2-107, button[type="submit"]')
        .first();
      if ((await continueBtn.count()) > 0) {
        console.log('[Stagehand] Clicking Continue on OTP verification screen');
        await continueBtn.click({ force: true });
      } else {
        await this.act('Click the Continue button');
      }

      await this.waitForNetworkIdle(3000);
      return true;
    } catch (err) {
      console.warn('[Stagehand] Failed to submit OTP directly:', err);
      try {
        await this.act(`Fill ${otp} in the OTP boxes and click Continue`);
        await this.waitForNetworkIdle(3000);
        return true;
      } catch (actErr) {
        console.warn('[Stagehand] Fallback act also failed:', actErr);
        return false;
      }
    }
  }
}

