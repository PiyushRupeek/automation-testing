import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ExplorerService } from './explorer.service';
import { ExploreRequestDto } from './dto/explore-request.dto';
import { ExploreResult } from './types/explorer.types';

/** How long (ms) to keep completed/failed job results in memory before auto-cleanup. */
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface ExplorationJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  result?: ExploreResult;
  createdAt: string;
  error?: string;
}

@Controller('api')
export class ExplorerController {
  private readonly jobs = new Map<string, ExplorationJob>();

  /**
   * ID of the currently running exploration, if any.
   * StagehandBrowserAdapter is a singleton with a single browser instance,
   * so parallel explorations would race on the same browser. We reject
   * concurrent requests with 409 Conflict to prevent this.
   */
  private activeExplorationId: string | null = null;

  constructor(private readonly explorerService: ExplorerService) {}

  @Post('explore')
  startExploration(@Body() body: ExploreRequestDto): { explorationId: string } {
    // Reject if another exploration is already in progress
    if (this.activeExplorationId !== null) {
      const running = this.jobs.get(this.activeExplorationId);
      if (running?.status === 'running') {
        throw new ConflictException(
          `An exploration is already running (id: ${this.activeExplorationId}). ` +
          `Poll GET /api/explore/${this.activeExplorationId} and wait for it to complete.`
        );
      }
      // Previous job finished but we missed cleaning up the pointer — reset
      this.activeExplorationId = null;
    }

    const id = crypto.randomUUID();
    const job: ExplorationJob = {
      id,
      status: 'running',
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, job);
    this.activeExplorationId = id;

    // Run exploration in background
    this.explorerService
      .explore({
        mode: body.mode,
        variant: body.variant,
        baseUrl: body.baseUrl,
        descriptorPath: body.descriptorPath,
        maxSteps: body.maxSteps,
        headless: body.headless ?? true,
      })
      .then(result => {
        job.status = result.status === 'failed' ? 'failed' : 'completed';
        job.result = result;
        job.error = result.error;
      })
      .catch(err => {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        // Release the concurrency lock
        if (this.activeExplorationId === id) {
          this.activeExplorationId = null;
        }
        // Schedule auto-cleanup so the jobs map doesn't grow unboundedly
        setTimeout(() => this.jobs.delete(id), JOB_TTL_MS);
      });

    return { explorationId: id };
  }

  @Get('explore/:id')
  getExplorationStatus(@Param('id') id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException(`Exploration ${id} not found`);

    return {
      explorationId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      error: job.error,
      result: job.result
        ? {
            mode: job.result.mode,
            status: job.result.status,
            completedSteps: job.result.completedSteps,
            totalExpectedSteps: job.result.totalExpectedSteps,
            flowStepsGenerated: job.result.generatedFlow.length,
            authBarriers: job.result.authBarriers.length,
            duration: job.result.duration,
            diff: job.result.diff
              ? {
                  added: job.result.diff.addedSteps.length,
                  removed: job.result.diff.removedSteps.length,
                  changed: job.result.diff.changedSteps.length,
                  unchanged: job.result.diff.unchangedStepNumbers.length,
                }
              : undefined,
          }
        : undefined,
    };
  }

  @Get('explore/:id/config')
  getGeneratedConfig(@Param('id') id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException(`Exploration ${id} not found`);
    if (!job.result?.generatedConfig) {
      throw new NotFoundException(`No generated config available for exploration ${id}`);
    }
    return job.result.generatedConfig;
  }
}
