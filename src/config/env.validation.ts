import { z } from 'zod';

/**
 * Single source of truth for environment variables.
 * Values are coerced (e.g. numeric strings -> numbers) and validated at boot;
 * the app refuses to start with an invalid/missing config.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('api'),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
  REFRESH_COOKIE_NAME: z.string().default('erp_rt'),

  THROTTLE_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  // ── Mail (SMTP) ──────────────────────────────────────────────────────────
  // Key names mirror the legacy Laravel .env so the same credentials drop straight in.
  // All optional: with no MAIL_HOST the app still boots and mail sending reports
  // "not configured" instead of crashing.
  MAIL_MAILER: z.string().default('smtp'),
  MAIL_HOST: z.string().optional().default(''),
  MAIL_PORT: z.coerce.number().int().positive().default(587),
  MAIL_USERNAME: z.string().optional().default(''),
  MAIL_PASSWORD: z.string().optional().default(''),
  /** 'tls' (STARTTLS, port 587) or 'ssl' (implicit TLS, port 465). */
  MAIL_ENCRYPTION: z.enum(['tls', 'ssl', '']).optional().default('tls'),
  MAIL_FROM_ADDRESS: z.string().optional().default(''),
  MAIL_FROM_NAME: z.string().optional().default(''),

  // ── S3 (document uploads) ────────────────────────────────────────────────
  // Optional: when AWS_BUCKET is empty, uploads fall back to local disk (./uploads).
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  AWS_DEFAULT_REGION: z.string().optional().default('ap-south-1'),
  AWS_BUCKET: z.string().optional().default(''),
  /** Set for S3-compatible providers (MinIO, DigitalOcean Spaces, Cloudflare R2). */
  AWS_ENDPOINT: z.string().optional().default(''),
  AWS_USE_PATH_STYLE_ENDPOINT: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
