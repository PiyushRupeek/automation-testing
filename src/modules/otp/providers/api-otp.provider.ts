import { Injectable } from '@nestjs/common';
import { OtpProvider } from '../otp.interface';

interface PendingOtp {
  resolve: (otp: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class ApiOtpProvider implements OtpProvider {
  private pending = new Map<string, PendingOtp>();

  getTimeoutMs(): number {
    const raw = process.env.OTP_API_TIMEOUT_MS;
    const n = raw ? parseInt(raw, 10) : 120000;
    return Number.isFinite(n) && n > 0 ? n : 120000;
  }

  async requestOtp(mobile?: string, runId?: string): Promise<string> {
    const key = runId ?? 'default';
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.reject(new Error('OTP request superseded'));
      this.pending.delete(key);
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`OTP timeout after ${this.getTimeoutMs()}ms — POST /api/runs/${key}/otp`));
      }, this.getTimeoutMs());

      this.pending.set(key, { resolve, reject, timer });
      console.log(
        mobile
          ? `Waiting for OTP via API for ${mobile} (POST /api/runs/${key}/otp)`
          : `Waiting for OTP via API (POST /api/runs/${key}/otp)`
      );
    });
  }

  submitOtp(runId: string, otp: string): boolean {
    const pending = this.pending.get(runId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(runId);

    if (!/^\d{4}$/.test(otp)) {
      pending.reject(new Error('Invalid OTP (expected 4 digits)'));
      return false;
    }

    pending.resolve(otp);
    return true;
  }

  cancelRun(runId: string): void {
    const pending = this.pending.get(runId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.reject(new Error('Run cancelled'));
    this.pending.delete(runId);
  }
}
