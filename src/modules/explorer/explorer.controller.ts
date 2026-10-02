import {
  Body,
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

  constructor(private readonly explorerService: ExplorerService) {}

  @Post('explore')
  startExploration(@Body() body: ExploreRequestDto): { explorationId: string } {
    const id = crypto.randomUUID();
    const job: ExplorationJob = {
      id,
      status: 'running',
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, job);

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
