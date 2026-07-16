import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { AUDITED_MODELS } from './audit.config';
import { diff, serialize, snapshot, toIntId } from './audit.diff';
import type { AuditService } from './audit.service';

const logger = new Logger('AuditMiddleware');

const SINGLE_ACTIONS = new Set(['create', 'update', 'delete', 'upsert']);
const BULK_ACTIONS = new Set(['createMany', 'updateMany', 'deleteMany']);
/** update/delete/upsert need the row as it was, before we overwrite it. */
const NEEDS_BEFORE = new Set(['update', 'delete', 'upsert']);

/** Prisma exposes `prisma.product` for model `Product`. */
const delegateName = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Watches every Prisma write and records the audited ones. One hook instead of GOURI's ~60 manual
 * `Util::activityLog()` calls — so a module can never be forgotten, and future modules
 * (purchases, sells, payments) are covered the moment they are added to AUDITED_MODELS.
 *
 * Uses `$use` rather than `$extends` deliberately: it attaches to the very PrismaService instance
 * every service already injects, so nothing downstream changes.
 */
export function createAuditMiddleware(prisma: PrismaService, audit: AuditService): Prisma.Middleware {
  return async (params, next) => {
    const model = params.model;
    const cfg = model ? AUDITED_MODELS[model] : undefined;
    const isSingle = SINGLE_ACTIONS.has(params.action);
    const isBulk = BULK_ACTIONS.has(params.action);

    // Fast path: unaudited model, a read, or an aggregate whose service logs it properly itself.
    if (!cfg || !model || cfg.manual || (!isSingle && !isBulk)) return next(params);

    let before: Record<string, any> | null = null;
    if (NEEDS_BEFORE.has(params.action) && params.args?.where) {
      try {
        before = await (prisma as any)[delegateName(model)].findFirst({ where: params.args.where });
      } catch {
        before = null; // best-effort: never block the write because we could not read the old row
      }
    }

    const result = await next(params);

    try {
      record(audit, cfg, model, params, before, result);
    } catch (err) {
      logger.error(`Failed to record ${params.action} on ${model}: ${String(err)}`);
    }
    return result;
  };
}

function record(
  audit: AuditService,
  cfg: (typeof AUDITED_MODELS)[string],
  model: string,
  params: Prisma.MiddlewareParams,
  before: Record<string, any> | null,
  result: any,
): void {
  const ctx = audit.context();

  if (BULK_ACTIONS.has(params.action)) {
    const count = result?.count ?? (Array.isArray(params.args?.data) ? params.args.data.length : 0);
    if (!count) return;
    const action = { createMany: 'bulk_created', updateMany: 'bulk_updated', deleteMany: 'bulk_deleted' }[
      params.action as string
    ]!;
    audit.log({
      action,
      subjectType: model,
      businessId: ctx.businessId ?? null,
      description: `${count} ${cfg.label.toLowerCase()} record(s) ${action.replace('bulk_', '')}`,
      properties: { count, where: serialize(params.args?.where) ?? null, route: ctx.route ?? null },
    });
    return;
  }

  const after = (result ?? null) as Record<string, any> | null;
  const subject = after ?? before;
  if (!subject) return;

  // A create returns a row with no prior state; an upsert tells us which it was by whether the row existed.
  const isCreate = params.action === 'create' || (params.action === 'upsert' && !before);
  const isDelete = params.action === 'delete';
  const action = isCreate ? 'created' : isDelete ? 'deleted' : 'updated';

  let properties: Record<string, unknown>;
  if (action === 'updated') {
    const changed = diff(before ?? {}, after ?? {}, cfg.skip);
    if (Object.keys(changed).length === 0) return; // a no-op write is not activity
    properties = { changed };
  } else {
    properties = { attributes: snapshot((isDelete ? before : after) ?? {}, cfg.skip) };
  }
  if (ctx.route) properties.route = ctx.route;

  const name = cfg.name?.(subject);
  audit.log({
    action,
    subjectType: model,
    subjectId: toIntId(subject.id),
    // The row's own tenant beats the caller's — they only differ when something is off, and then we
    // want the entry filed where the record actually lives.
    businessId: toIntId(subject.businessId) ?? ctx.businessId ?? null,
    description: `${cfg.label}${name ? ` "${name}"` : ''} ${action}`,
    properties,
  });
}
