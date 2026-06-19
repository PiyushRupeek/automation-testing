import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import { Response } from 'express';
import * as path from 'path';
import { Observable } from 'rxjs';
import { RunProgressEvent } from '../../common/types';
import { StartRunDto } from '../test-engine/dto/start-run.dto';
import { RunsService } from './runs.service';

class SubmitOtpDto {
  otp!: string;
}

@Controller('api')
export class RunsController {
  constructor(
    private readonly runsService: RunsService
  ) {}

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Post('runs')
  startRun(@Body() body: StartRunDto): { runId: string } {
    return this.runsService.startRun(body);
  }

  @Get('runs')
  listRuns() {
    return this.runsService.listRuns();
  }

  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    const job = this.runsService.getRun(id);
    return {
      runId: job.runId,
      variant: job.variant,
      mode: job.mode,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result
        ? {
            passed: job.result.passed,
            failed: job.result.failed,
            totalSteps: job.result.totalSteps,
            duration: job.result.duration,
            summary: job.result.summary,
          }
        : undefined,
    };
  }

  @Sse('runs/:id/events')
  streamEvents(@Param('id') id: string): Observable<MessageEvent> {
    const job = this.runsService.getRun(id);

    return new Observable((subscriber) => {
      const onEvent = (event: RunProgressEvent) => {
        subscriber.next({ data: event } as MessageEvent);
        if (event.type === 'run_completed' || event.type === 'run_failed') {
          subscriber.complete();
        }
      };

      job.emitter.on('event', onEvent);

      const heartbeat = setInterval(() => {
        subscriber.next({
          data: {
            type: 'heartbeat',
            runId: id,
            timestamp: new Date().toISOString(),
          },
        } as MessageEvent);
      }, 15000);

      if (job.status === 'completed' || job.status === 'failed') {
        subscriber.next({
          data: {
            type: job.status === 'completed' ? 'run_completed' : 'run_failed',
            runId: id,
            timestamp: job.completedAt ?? new Date().toISOString(),
            result: job.result,
            error: job.error,
          },
        } as MessageEvent);
        subscriber.complete();
      }

      return () => {
        clearInterval(heartbeat);
        job.emitter.off('event', onEvent);
      };
    });
  }

  @Get('runs/:id/report')
  @Header('Cache-Control', 'no-cache')
  getReport(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response
  ): void {
    const fmt = format === 'json' ? 'json' : 'html';
    const filePath = this.runsService.getReportPath(id, fmt);
    if (fmt === 'json') {
      res.type('application/json');
    } else {
      res.type('text/html');
    }
    res.sendFile(path.resolve(filePath), (err) => {
      if (err && !res.headersSent) {
        throw new NotFoundException(`Report not found for run ${id}`);
      }
    });
  }

  @Post('runs/:id/otp')
  submitOtp(@Param('id') id: string, @Body() body: SubmitOtpDto): { accepted: boolean } {
    return this.runsService.submitOtp(id, body.otp);
  }
}
