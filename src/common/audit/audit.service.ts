import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AUDITED_MODELS } from './audit.config';
import { diff, snapshot } from './audit.diff';
import { createAuditMiddleware } from './audit.middleware';
import { AUDIT_CTX_KEY, type AuditContext, type AuditEntry } from './audit.types';

/** Flush when either fires — whichever comes first. */
const FLUSH_INTERVAL_MS = 1_000;
const FLUSH_BATCH_SIZE = 200;
/** Hard memory ceiling. If the DB is down we drop the oldest entries rather than grow forever. */
const MAX_BUFFER = 5_000;
/** Matches GOURI's activity-log retention. Without it the table only ever grows. */
const RETENTION_DAYS = 365;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Writes the activity trail.
 *
 * The whole point is that auditing must be invisible to the request: entries are buffered in memory
 * and flushed as ONE `createMany` per batch. On Neon every round-trip costs real latency, so writing
 * a row inline (GOURI's model) would tax every single mutation — and, worse, a failing audit insert
 * inside the caller's `$transaction` would roll back their actual work. Nothing here is awaited by a
 * request handler, and every failure is swallowed after logging.
 */
@Injectable()
export class AuditService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AuditService.name);
  private buffer: AuditEntry[] = [];
  private timer?: NodeJS.Timeout;
  private purgeTimer?: NodeJS.Timeout;
  private flushing?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  /** Attach the auto-capture hook to the same PrismaService instance every service injects. */
  onModuleInit(): void {
    this.prisma.$use(createAuditMiddleware(this.prisma, this));
    this.logger.log('Audit trail active (auto-capture + batched writes)');

    // A plain timer rather than a scheduler dependency: the purge is idempotent, so it is harmless
    // if several instances run it. unref'd so it never holds the process open.
    this.purgeTimer = setInterval(() => void this.purgeExpired(), PURGE_INTERVAL_MS);
    this.purgeTimer.unref();
    const firstRun = setTimeout(() => void this.purgeExpired(), 60_000);
    firstRun.unref();
  }

  /** Drop entries past the retention window. */
  async purgeExpired(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
      const { count } = await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (count > 0) this.logger.log(`Purged ${count} audit entries older than ${RETENTION_DAYS} days`);
    } catch (err) {
      this.logger.error(`Audit purge failed: ${String(err)}`);
    }
  }

  /** The current request's causer/tenant, or an empty context outside a request (seeds, cron). */
  context(): AuditContext {
    if (!this.cls.isActive()) return {};
    return this.cls.get<AuditContext>(AUDIT_CTX_KEY) ?? {};
  }

  /**
   * Record an entry. Fire-and-forget by design — callers never await it.
   * Explicit calls are for things no DB write can imply: login, logout, failed login.
   */
  log(entry: AuditEntry): void {
    const ctx = this.context();
    this.buffer.push({
      ...entry,
      businessId: entry.businessId ?? ctx.businessId ?? null,
      userId: entry.userId ?? ctx.userId ?? null,
      ipAddress: entry.ipAddress ?? ctx.ipAddress ?? null,
      userAgent: entry.userAgent ?? ctx.userAgent ?? null,
      properties: entry.properties ?? null,
    });

    if (this.buffer.length > MAX_BUFFER) {
      const dropped = this.buffer.length - MAX_BUFFER;
      this.buffer.splice(0, dropped);
      this.logger.warn(`Audit buffer overflow — dropped ${dropped} oldest entries`);
    }
    if (this.buffer.length >= FLUSH_BATCH_SIZE) void this.flush();
    else this.schedule();
  }

  /**
   * Record a change the middleware cannot see for itself, from flat before/after snapshots the
   * service builds (see AUDITED_MODELS `manual`). Produces the identical entry shape, so the report
   * and the UI cannot tell the two paths apart.
   */
  record(opts: {
    model: string;
    subjectId: number;
    action: 'created' | 'updated' | 'deleted';
    /** Required for 'updated'; ignored otherwise. */
    before?: Record<string, any> | null;
    /** The state to snapshot for 'created'/'deleted', and the new state for 'updated'. */
    after?: Record<string, any> | null;
    name?: string;
    businessId?: number | null;
  }): void {
    const cfg = AUDITED_MODELS[opts.model];
    const label = cfg?.label ?? opts.model;
    const ctx = this.context();

    let properties: Record<string, unknown>;
    if (opts.action === 'updated') {
      const changed = diff(opts.before ?? {}, opts.after ?? {}, cfg?.skip);
      if (Object.keys(changed).length === 0) return; // a no-op save is not activity
      properties = { changed };
    } else {
      properties = { attributes: snapshot(opts.after ?? opts.before ?? {}, cfg?.skip) };
    }
    if (ctx.route) properties.route = ctx.route;

    this.log({
      action: opts.action,
      subjectType: opts.model,
      subjectId: opts.subjectId,
      businessId: opts.businessId ?? ctx.businessId ?? null,
      description: `${label}${opts.name ? ` "${opts.name}"` : ''} ${opts.action}`,
      properties,
    });
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref(); // never keep the process alive just for a pending flush
  }

  /** Drain the buffer into one batched insert. Safe to call concurrently — flushes serialize. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.flushing) return this.flushing;
    if (this.buffer.length === 0) return;

    const rows = this.buffer;
    this.buffer = [];
    this.flushing = this.prisma.auditLog
      .createMany({ data: rows as never })
      .then(() => undefined)
      .catch((err: unknown) => {
        // An unwritable trail must never surface as a failed business operation.
        this.logger.error(`Failed to write ${rows.length} audit entries: ${String(err)}`);
      })
      .finally(() => {
        this.flushing = undefined;
        if (this.buffer.length > 0) this.schedule();
      });
    return this.flushing;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    await this.flush(); // never lose a buffered entry on a graceful restart
  }
}
