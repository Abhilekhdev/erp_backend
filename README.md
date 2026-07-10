# ERP Panel — Backend (NestJS)

Modern PERN backend for the ERP (converted from the UltimatePOS Laravel 9 reference in `GOURI_DEV`).

## Stack
NestJS 10 · TypeScript · PostgreSQL · Prisma 5 · Redis · BullMQ · JWT (+ rotating refresh) · Socket.IO · Docker.

## Architecture
Feature-based, Clean Architecture per module: **Controller → Service → Repository (Prisma) → DTO + Zod validation**.
Tenant isolation (`business_id`) is enforced centrally (Prisma extension + `nestjs-cls` request context), never per-query.

```
src/
  main.ts               app bootstrap (helmet, cors, cookies, global prefix)
  app.module.ts         root wiring (config, throttler, cls, prisma, health)
  config/               Zod-validated environment
  common/               filters, interceptors, shared HTTP contracts
  infra/prisma/         PrismaModule + PrismaService (global)
  modules/
    health/             GET /api/health (liveness + DB ping)
    auth/ …             (next: STEP 6)
prisma/schema.prisma    DB schema (auth · RBAC · tenancy slice)
```

## Getting started

```bash
cp .env.example .env        # then set JWT secrets + DATABASE_URL
docker compose up -d postgres redis   # or use your own PG/Redis
npm install
npm run prisma:generate
npm run prisma:migrate      # creates the initial migration
npm run start:dev
```

Verify: `GET http://localhost:4000/api/health` → `{ "success": true, "data": { "status": "ok", ... } }`.

## Run everything in Docker
```bash
cp .env.example .env
docker compose up --build
```

## Conventions
- Every response is wrapped as `{ success, data }` (success) or `{ success: false, error }` (failure).
- Env is validated at boot — the app refuses to start with missing/invalid config.
- Legacy MySQL column/table names are preserved via Prisma `@map`/`@@map` for a faithful data import.
