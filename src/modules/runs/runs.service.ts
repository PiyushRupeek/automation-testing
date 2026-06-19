import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import { FlowVariant, RunMode } from '../../common/types';
import { RunJob, RunManagerService } from './run-manager.service';

@Injectable()
export class RunsService {
  constructor(private readonly runManager: RunManagerService) {}

  startRun(body: { variant: FlowVariant; mode?: RunMode; autoHeal?: boolean }): { runId: string } {
    const variant = body.variant;
    const mode =
      body.mode ?? (variant === 'state-management' ? 'scenarios' : 'all');
    const job = this.runManager.createJob(variant, mode, body.autoHeal);
    return { runId: job.runId };
  }

  listRuns(): Array<{
    runId: string;
    variant: FlowVariant;
    mode: RunMode;
    status: string;
    createdAt: string;
    passed?: number;
    failed?: number;
  }> {
    return this.runManager.listJobs().map((j) => ({
      runId: j.runId,
      variant: j.variant,
      mode: j.mode,
      status: j.status,
      createdAt: j.createdAt,
      passed: j.result?.passed,
      failed: j.result?.failed,
    }));
  }

  getRun(runId: string): RunJob {
    const job = this.runManager.getJob(runId);
    if (!job) throw new NotFoundException(`Run ${runId} not found`);
    return job;
  }

  getReportPath(runId: string, format: 'html' | 'json'): string {
    const job = this.getRun(runId);
    if (!job.runDir) {
      throw new NotFoundException(`Report not ready for run ${runId}`);
    }
    const file = format === 'json' ? 'result.json' : 'report.html';
    const filePath = `${job.runDir}/${file}`.replace(/\/+/g, '/');
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Report file not found for run ${runId}`);
    }
    return filePath;
  }

  submitOtp(runId: string, otp: string): { accepted: boolean } {
    const job = this.getRun(runId);
    if (job.status !== 'running') {
      throw new NotFoundException(`Run ${runId} is not active`);
    }
    const accepted = this.runManager.submitOtp(runId, otp);
    return { accepted };
  }
}
