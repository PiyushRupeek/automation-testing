import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { RunJobStatus, RunProgressEvent, RunResult } from '../../common/types';
import { FlowVariant, RunMode } from '../../common/types';
import { ApiOtpProvider } from '../otp/providers/api-otp.provider';
import { TestEngineService } from '../test-engine/test-engine.service';

export interface RunJob {
  runId: string;
  variant: FlowVariant;
  mode: RunMode;
  autoHeal?: boolean;
  status: RunJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: RunResult;
  runDir?: string;
  htmlPath?: string;
  error?: string;
  emitter: EventEmitter;
}

@Injectable()
export class RunManagerService {
  private jobs = new Map<string, RunJob>();
  private queue: string[] = [];
  private activeCount = 0;

  constructor(
    private readonly testEngine: TestEngineService,
    private readonly apiOtp: ApiOtpProvider
  ) {}

  private get maxConcurrent(): number {
    const raw = process.env.MAX_CONCURRENT_RUNS;
    const n = raw ? parseInt(raw, 10) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  createJob(variant: FlowVariant, mode: RunMode, autoHeal?: boolean): RunJob {
    const runId = crypto.randomUUID();
    const job: RunJob = {
      runId,
      variant,
      mode,
      autoHeal,
      status: 'queued',
      createdAt: new Date().toISOString(),
      emitter: new EventEmitter(),
    };
    this.jobs.set(runId, job);

    this.queue.push(runId);
    setImmediate(() => this.processQueue(runId));

    return job;
  }

  getJob(runId: string): RunJob | undefined {
    return this.jobs.get(runId);
  }

  listJobs(): RunJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  submitOtp(runId: string, otp: string): boolean {
    return this.apiOtp.submitOtp(runId, otp);
  }

  private emit(job: RunJob, event: Omit<RunProgressEvent, 'runId' | 'timestamp'>): void {
    const payload: RunProgressEvent = {
      ...event,
      runId: job.runId,
      timestamp: new Date().toISOString(),
    };
    job.emitter.emit('event', payload);
  }

  private async processQueue(runId: string): Promise<void> {
    if (this.activeCount >= this.maxConcurrent) {
      return;
    }

    const idx = this.queue.indexOf(runId);
    if (idx === -1) return;

    this.queue.splice(idx, 1);
    const job = this.jobs.get(runId);
    if (!job) return;

    this.activeCount++;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.emit(job, { type: 'run_started' });

    try {
      const result = await this.testEngine.runTestSuite({
        runId,
        variant: job.variant,
        mode: job.mode,
        autoHeal: job.autoHeal,
        onProgress: (ev) => {
          if (ev.type === 'step_started') {
            this.emit(job, { type: 'step_started', step: ev.step, stepName: ev.stepName });
          } else if (ev.type === 'step_completed') {
            this.emit(job, {
              type: 'step_completed',
              step: ev.step,
              stepName: ev.stepName,
              status: ev.status,
              error: ev.error,
            });
          }
        },
      });

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.result = result;
      job.runDir = result.runDir;
      job.htmlPath = result.htmlPath;
      this.emit(job, { type: 'run_completed', result });
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = err instanceof Error ? err.message : String(err);
      this.apiOtp.cancelRun(runId);
      this.emit(job, { type: 'run_failed', error: job.error });
    } finally {
      this.activeCount--;
      this.processNextInQueue();
    }
  }

  private processNextInQueue(): void {
    if (this.queue.length === 0 || this.activeCount >= this.maxConcurrent) return;

    const nextId = this.queue[0];
    const job = this.jobs.get(nextId);
    if (!job) {
      this.queue.shift();
      this.processNextInQueue();
      return;
    }

    setImmediate(() => this.processQueue(nextId));
  }
}
