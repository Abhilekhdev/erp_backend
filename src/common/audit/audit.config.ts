/**
 * What the audit trail covers, and how each entry is made human-readable.
 *
 * GOURI logs activity by hand-calling `Util::activityLog()` at ~60 call sites, which is why whole
 * areas (products and the entire catalogue) silently have no trail at all. We invert that: a single
 * Prisma middleware watches every write, and THIS map is the only thing that decides what is worth
 * recording. Adding a module to the trail = one line here.
 */

export interface AuditedModel {
  /** Human label for the record type, e.g. "Product". */
  label: string;
  /** Resolves the record's display name so the log reads "Product 'iPhone 15'" not "Product #12". */
  name?: (row: Record<string, any>) => string | undefined;
  /** Extra fields (beyond REDACTED_FIELDS) to keep out of the diff for this model. */
  skip?: string[];
  /**
   * The service records this model itself — the middleware stays out of the way.
   * Needed for aggregates whose meaningful state is NOT in their own row: a product's prices live
   * in child `variations`, which a save deletes and recreates wholesale. Left to the middleware,
   * a price edit would read "Product updated" with no diff, plus a burst of child-row churn.
   */
  manual?: boolean;
}

const full = (...parts: (string | null | undefined)[]): string | undefined =>
  parts.filter(Boolean).join(' ').trim() || undefined;

/** Prisma model name → audit config. Models absent from this map are never touched. */
export const AUDITED_MODELS: Record<string, AuditedModel> = {
  Product: { label: 'Product', name: (r) => r.name, manual: true }, // prices live in child rows — see ProductsService
  Contact: { label: 'Contact', name: (r) => r.supplierBusinessName || r.name || full(r.firstName, r.lastName) },
  CustomerGroup: { label: 'Customer group', name: (r) => r.name },
  User: { label: 'User', name: (r) => full(r.firstName, r.lastName) || r.username || r.email },
  Role: { label: 'Role', name: (r) => r.name },
  Category: { label: 'Category', name: (r) => r.name },
  Brand: { label: 'Brand', name: (r) => r.name },
  Unit: { label: 'Unit', name: (r) => r.actualName },
  TaxRate: { label: 'Tax rate', name: (r) => r.name },
  SellingPriceGroup: { label: 'Selling price group', name: (r) => r.name },
  Warranty: { label: 'Warranty', name: (r) => r.name },
  VariationTemplate: { label: 'Variation template', name: (r) => r.name },
  BusinessLocation: { label: 'Business location', name: (r) => r.name },
  BusinessSetting: { label: 'Business settings' },
  // Purchases are logged by the service, not the middleware: a purchase is a document plus its
  // lines plus its stock movements, and the generic hook would only see "Transaction updated"
  // with no diff — the same reason Product is `manual`.
  Purchase: { label: 'Purchase', manual: true },
  PurchasePayment: { label: 'Purchase payment', manual: true },
  PurchaseRequisition: { label: 'Purchase requisition', manual: true },
  PurchaseOrder: { label: 'Purchase order', manual: true },
  PurchaseReturn: { label: 'Purchase return', manual: true },
  // Sell, StockTransfer and the rest join as they are built.
};

/**
 * Never written to `properties`, on any model. A diff is stored verbatim, so a leaked hash here
 * would be readable by anyone with the Activity Log permission — worse than not logging at all.
 */
export const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'tokenHash',
  'rememberToken',
  'refreshToken',
  'apiToken',
  'secret',
  'clientSecret',
]);

/** Bookkeeping columns that change on every write and carry no meaning for a reader. */
export const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt']);

/** Fields whose camelCase→"Camel case" default reads badly. Everything else is humanized. */
const FIELD_LABELS: Record<string, string> = {
  sku: 'SKU',
  dob: 'Date of birth',
  parentId: 'Manager',
  categoryId: 'Category',
  subCategoryId: 'Sub category',
  brandId: 'Brand',
  unitId: 'Unit',
  taxId: 'Tax',
  deletedAt: 'Deleted',
  isActive: 'Active',
  allowLogin: 'Login allowed',
  cmmsnPercent: 'Commission %',
  maxSalesDiscountPercent: 'Max sales discount %',
};

/** `sellPrice` → "Sell price"; ids stay readable ("Category" not "CategoryId"). */
export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
