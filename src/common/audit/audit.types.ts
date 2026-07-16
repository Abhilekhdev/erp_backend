/** Who did it — resolved once per request from the JWT and carried in CLS. */
export interface AuditContext {
  userId?: number;
  businessId?: number | null;
  ipAddress?: string;
  userAgent?: string;
  /** e.g. "PUT /api/products/12" — cheap breadcrumb for debugging a surprising entry. */
  route?: string;
}

/** CLS key holding the AuditContext for the current request. */
export const AUDIT_CTX_KEY = 'auditCtx';

/** A single trail entry, as handed to the AuditService buffer. */
export interface AuditEntry {
  businessId?: number | null;
  userId?: number | null;
  action: string;
  subjectType?: string | null;
  subjectId?: number | null;
  description?: string | null;
  properties?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}
