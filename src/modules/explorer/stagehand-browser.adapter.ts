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

    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
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
}
