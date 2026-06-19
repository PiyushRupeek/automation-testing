import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TestEngineService } from './modules/test-engine/test-engine.service';

async function bootstrap(): Promise<void> {
  process.env.RUN_CONTEXT = process.env.RUN_CONTEXT ?? 'cli';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const engine = app.get(TestEngineService);
    const exitCode = await engine.runFromCli(process.argv);
    await app.close();
    process.exit(exitCode);
  } catch (err) {
    console.error('Fatal error:', err);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
