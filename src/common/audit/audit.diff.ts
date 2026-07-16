import { Prisma } from '@prisma/client';
import { IGNORED_FIELDS, REDACTED_FIELDS } from './audit.config';

/** Make a value safe for a Json column and readable in the UI. */
export function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Buffer.isBuffer(value)) return '[binary]';
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_FIELDS.has(k) ? '[redacted]' : serialize(v);
    }
    return out;
  }
  return value;
}

/** Flat snapshot of a row, minus secrets, relations and bookkeeping columns. */
export function snapshot(row: Record<string, any>, skip: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    if (REDACTED_FIELDS.has(k) || IGNORED_FIELDS.has(k) || skip.includes(k)) continue;
    if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Prisma.Decimal.isDecimal(v)) {
      continue; // relations / nested writes — the related model logs itself
    }
    out[k] = serialize(v);
  }
  return out;
}

/**
 * The "what actually changed" payload — the single most useful thing in the trail, and exactly what
 * GOURI never manages to record (its diff reads `$log_properties`, which no model defines).
 */
export function diff(
  before: Record<string, any>,
  after: Record<string, any>,
  skip: string[] = [],
): Record<string, { from: unknown; to: unknown }> {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after ?? {})) {
    if (REDACTED_FIELDS.has(key) || IGNORED_FIELDS.has(key) || skip.includes(key)) continue;
    if (!(key in (before ?? {}))) continue;
    const from = serialize(before[key]);
    const to = serialize(after[key]);
    if (from === null && to === null) continue;
    if (JSON.stringify(from) !== JSON.stringify(to)) changed[key] = { from, to };
  }
  return changed;
}

export const toIntId = (id: unknown): number | null =>
  typeof id === 'bigint' ? Number(id) : typeof id === 'number' ? id : null;
