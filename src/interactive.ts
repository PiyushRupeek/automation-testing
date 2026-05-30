import * as readline from 'readline';

function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'y') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'n') return false;
  return undefined;
}

export function isInteractiveOtpEnabled(): boolean {
  const explicit = parseBoolEnv(process.env.INTERACTIVE_OTP);
  if (explicit !== undefined) return explicit;

  if (process.env.TEST_OTP === undefined || process.env.TEST_OTP.trim() === '') {
    return true;
  }

  return Boolean(process.stdin.isTTY);
}

export function getOtpPromptDelayMs(): number {
  const raw = process.env.OTP_PROMPT_DELAY_MS;
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 3000;
  return Math.floor(n);
}

function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

export async function promptForOtp(mobile?: string): Promise<string> {
  const prefix = mobile ? `OTP for ${mobile}: ` : 'OTP: ';

  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = (await question(`${prefix}`)).trim();
    if (/^\d{4}$/.test(answer)) return answer;
    if (attempt === 0) {
      // eslint-disable-next-line no-console
      console.log('Please enter a 4-digit OTP.');
    }
  }

  throw new Error('Invalid OTP input (expected 4 digits).');
}

