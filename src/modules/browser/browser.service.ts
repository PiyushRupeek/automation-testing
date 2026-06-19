import { Injectable } from '@nestjs/common';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { ExecuteActionInput } from '../../common/types';

export class InvalidSelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSelectorError';
  }
}

export function validateFillSelector(selector: string): void {
  if (/\[value\s*=/.test(selector)) {
    throw new InvalidSelectorError(
      `Fill selector must not use [value=...] (dynamic): ${selector}`
    );
  }
}

function isHeadless(): boolean {
  return process.env.HEADLESS !== 'false';
}

function resolveChromiumExecutablePath(): string | undefined {
  const fromEnv = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (fromEnv) return fromEnv;

  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  return undefined;
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private consoleErrors: string[] = [];
  private screenshotsDir: string;

  constructor(screenshotsDir: string) {
    this.screenshotsDir = screenshotsDir;
  }

  async launch(): Promise<void> {
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }

    const executablePath = resolveChromiumExecutablePath();
    this.browser = await chromium.launch({
      headless: isHeadless(),
      executablePath,
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    this.page = await this.context.newPage();

    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push(msg.text());
      }
    });

    this.page.on('pageerror', (err) => {
      this.consoleErrors.push(err.message);
    });
  }

  private getPage(): Page {
    if (!this.page) {
      throw new Error('Browser not launched. Call launch() first.');
    }
    return this.page;
  }

  async navigate(url: string, timeout = 30000): Promise<void> {
    const page = this.getPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout });
  }

  async reload(timeout = 30000): Promise<void> {
    const page = this.getPage();
    await page.reload({ waitUntil: 'networkidle', timeout });
  }

  async clearStorage(target = 'sessionStorage'): Promise<void> {
    const page = this.getPage();
    await page.evaluate((storageTarget) => {
      const w = globalThis as Record<string, { clear?: () => void } | undefined>;
      if (storageTarget === 'localStorage') {
        w.localStorage?.clear?.();
      } else {
        w.sessionStorage?.clear?.();
      }
    }, target);
  }

  async resetSessionState(): Promise<void> {
    if (this.context) {
      await this.context.clearCookies();
    }
  }

  async clearPageStorage(): Promise<void> {
    try {
      await this.clearStorage('sessionStorage');
      await this.clearStorage('localStorage');
    } catch {
      // Storage may be unavailable before first navigation
    }
  }

  getCurrentUrl(): string {
    return this.getPage().url();
  }

  private isCtaLabel(label?: string): boolean {
    if (!label) return false;
    return /continue|submit|proceed|book emergency/i.test(label);
  }

  private async waitForMeetingContinueEnabled(timeoutMs = 20000): Promise<void> {
    const page = this.getPage();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const btn = page.locator('button[class*="ctaButton"], button:has-text("Continue")').first();
      if ((await btn.count()) > 0 && !(await btn.isDisabled())) return;
      await page.waitForTimeout(300);
    }
    throw new Error('Continue button is still disabled — no time slot selected');
  }

  private async clickFirstAvailableTimeSlot(): Promise<void> {
    const page = this.getPage();
    const slotLocator = page.locator('[class*="slotBtn"]:not([disabled])');
    const count = await slotLocator.count();
    if (count === 0) {
      throw new Error('No available time slot buttons found for selected date');
    }
    const target = slotLocator.first();
    await target.waitFor({ state: 'visible', timeout: 15000 });
    await target.scrollIntoViewIfNeeded();
    await target.click({ timeout: 15000 });
    await page.waitForTimeout(500);
  }

  private async isAlreadySelected(selector: string): Promise<boolean> {
    const page = this.getPage();
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) return false;
    const className = (await locator.getAttribute('class')) ?? '';
    return /active/i.test(className);
  }

  private async clickNextAvailableDate(): Promise<void> {
    const page = this.getPage();
    const dates = page.locator('[class*="date"]:not([class*="selected"]), [class*="Date"]:not([class*="selected"])');
    if ((await dates.count()) === 0) {
      throw new Error('No alternate date available in calendar');
    }
    await dates.first().click({ timeout: 15000 });
    await page.waitForTimeout(800);
  }

  private async fillInput(selector: string, value: string): Promise<void> {
    validateFillSelector(selector);
    const page = this.getPage();
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 15000 });
    await locator.click({ timeout: 15000 });

    const setValueViaNativeSetter = async (next: string): Promise<void> => {
      await locator.evaluate((el, val) => {
        const input = el as any;
        const setter = Object.getOwnPropertyDescriptor(
          (globalThis as any).HTMLInputElement?.prototype,
          'value'
        )?.set;
        setter?.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, next);
    };

    const getValue = async (): Promise<string> => {
      try {
        return await locator.inputValue();
      } catch {
        return await locator.evaluate((el) => (el as any).value);
      }
    };

    const isValueApplied = async (): Promise<boolean> => {
      if (!value) return true;
      const current = (await getValue()).trim();
      return current === value;
    };

    await setValueViaNativeSetter('');
    if (value) await setValueViaNativeSetter(value);

    if (!(await isValueApplied())) {
      await locator.fill(value);
    }

    if (!(await isValueApplied())) {
      await locator.fill('');
      if (value) {
        await locator.pressSequentially(value, { delay: 40 });
      }
      await locator.dispatchEvent('input');
      await locator.dispatchEvent('change');
    }

    if (!(await isValueApplied())) {
      const current = await getValue();
      throw new Error(
        `Fill did not stick for selector "${selector}". Expected "${value}", got "${current}".`
      );
    }

    await locator.blur();
  }

  private async performClick(selector: string): Promise<void> {
    const page = this.getPage();
    await page.waitForTimeout(100);

    const textMatch = selector.match(/has-text\(['"](.+?)['"]\)/);
    if (textMatch) {
      const text = textMatch[1].replace(/\\'/g, "'");
      const byText = page.getByText(text, { exact: true });
      if ((await byText.count()) > 0) {
        const target = byText.first();
        await target.waitFor({ state: 'visible', timeout: 15000 });
        await target.scrollIntoViewIfNeeded();
        await target.click({ timeout: 15000 });
        await page.waitForTimeout(400);
        return;
      }
    }

    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 15000 });
    await locator.scrollIntoViewIfNeeded();
    await locator.click({ timeout: 15000 });
    await page.waitForTimeout(400);
  }

  private async clickWhenEnabled(selector: string): Promise<void> {
    const page = this.getPage();
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 15000 });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (!(await locator.isDisabled())) break;
      await page.waitForTimeout(250);
    }
    if (await locator.isDisabled()) {
      throw new Error(`Element is still disabled: ${selector}`);
    }
    await this.performClick(selector);
  }

  async clickMeetingSlotsContinue(): Promise<void> {
    await this.waitForMeetingContinueEnabled();
    const page = this.getPage();
    const btn = page.locator('button[class*="ctaButton"], button:has-text("Continue")').first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click({ timeout: 15000 });
    await page.waitForTimeout(1000);
  }

  async executeAction(input: ExecuteActionInput): Promise<void> {
    const page = this.getPage();
    const { selector, action, value, file, label } = input;

    switch (action) {
      case 'click':
        if (label && /time slot on selected date/i.test(label)) {
          try {
            await this.clickFirstAvailableTimeSlot();
          } catch {
            await this.clickNextAvailableDate();
            await this.clickFirstAvailableTimeSlot();
          }
          break;
        }
        if (await this.isAlreadySelected(selector)) {
          return;
        }
        if (this.isCtaLabel(label)) {
          if (label && /continue on meeting slots/i.test(label)) {
            await this.waitForMeetingContinueEnabled();
          }
          await this.clickWhenEnabled(selector);
        } else {
          await this.performClick(selector);
        }
        break;
      case 'fill':
        validateFillSelector(selector);
        await this.fillInput(selector, value ?? '');
        break;
      case 'select':
        await page.selectOption(selector, value ?? '', { timeout: 15000 });
        break;
      case 'upload':
        if (!file) throw new Error('Upload action requires a file path');
        await page.setInputFiles(selector, path.resolve(file));
        break;
      case 'check':
        await page.check(selector, { timeout: 15000 });
        break;
      case 'uncheck':
        await page.uncheck(selector, { timeout: 15000 });
        break;
      case 'assert_text':
        break;
      default:
        throw new Error(`Unknown action type: ${action}`);
    }
  }

  async getPageHTML(): Promise<string> {
    return this.getPage().content();
  }

  async screenshot(filename: string): Promise<string> {
    const filepath = path.join(this.screenshotsDir, filename);
    await this.getPage().screenshot({ path: filepath, fullPage: true });
    return filepath;
  }

  async screenshotBase64(): Promise<string> {
    const buffer = await this.getPage().screenshot({ fullPage: false });
    return buffer.toString('base64');
  }

  getConsoleErrors(): string[] {
    return [...this.consoleErrors];
  }

  clearConsoleErrors(): void {
    this.consoleErrors = [];
  }

  async clearCookies(names: string[]): Promise<void> {
    if (!this.context) return;
    for (const name of names) {
      await this.context.clearCookies({ name });
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.page = null;
  }
}

@Injectable()
export class BrowserService {
  createForRun(screenshotsDir: string): BrowserSession {
    return new BrowserSession(screenshotsDir);
  }
}
