import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { join } from 'node:path';

import { AppModule } from './app.module';
import { StorageService } from './common/services/storage.service';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.use(compression());

  // Uploaded assets (logos, product images, documents) are always addressed as `/uploads/<path>`,
  // whichever backend stores them — so switching to S3 needs no data migration and no frontend change.
  // In S3 mode this redirects to a short-lived presigned URL (bucket stays private); otherwise the
  // request falls through to the static folder below.
  const storage = app.get(StorageService);
  app.use('/uploads', (req: Request, res: Response, next: NextFunction) => {
    if (!storage.isS3()) return next();
    const key = decodeURIComponent(req.path.replace(/^\/+/, ''));
    if (!key) return next();
    storage
      .url(key)
      .then((url) => res.redirect(302, url))
      .catch(() => next());
  });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }));
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }).split(',').map((o) => o.trim()),
    credentials: true,
  });

  // Global Zod validation — only DTOs built with `createZodDto` are validated; others pass through.
  app.useGlobalPipes(new ZodValidationPipe());
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  const prefix = config.get('API_PREFIX', { infer: true });
  await app.listen(port);
  Logger.log(`ERP Panel API ready → http://localhost:${port}/${prefix}`, 'Bootstrap');
}

void bootstrap();
