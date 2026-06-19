import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  process.env.RUN_CONTEXT = 'api';

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    })
  );

  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.API_HOST ?? '0.0.0.0';

  await app.listen(port, host);
  console.log(`API listening on http://${host}:${port}/api`);
}

bootstrap().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
