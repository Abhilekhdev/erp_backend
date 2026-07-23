import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());

export const requisitionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  /** Matches the reference number. */
  search: z.string().optional().default(''),
  locationId: optId,
  status: z.preprocess(blank, z.enum(['ordered', 'partial', 'completed']).optional()),
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
  /** The "required by" date, which is a different column from the document date. */
  requiredFrom: z.preprocess(blank, z.coerce.date().optional()),
  requiredTo: z.preprocess(blank, z.coerce.date().optional()),
});

export class RequisitionsQueryDto extends createZodDto(requisitionsQuerySchema) {}

/**
 * A requisition line is a quantity and nothing else — no supplier, no price. GOURI stores
 * `purchase_price_inc_tax = 0` on these rows, which then silently pollutes any report that sums
 * purchase-line cost across types; we simply leave the money columns at their defaults and never
 * read them for this document type.
 */
export const requisitionLineSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  variation_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  secondary_unit_quantity: z.preprocess(blank, z.coerce.number().min(0).optional().default(0)),
});

export const saveRequisitionSchema = z.object({
  location_id: z.coerce.number().int().positive('Select a business location'),
  /** Blank auto-generates. GOURI shows this field and then discards whatever you type. */
  ref_no: z.preprocess(blank, z.string().max(191).optional()),
  transaction_date: z.preprocess(blank, z.string().optional()),
  /** "Required by" — GOURI's `delivery_date` on this type. */
  delivery_date: z.preprocess(blank, z.string().optional()),
  additional_notes: z.preprocess(blank, z.string().optional()),
  requisitions: z.array(requisitionLineSchema).min(1, 'Add at least one product'),
});

export type RequisitionLineInput = z.infer<typeof requisitionLineSchema>;
export class SaveRequisitionDto extends createZodDto(saveRequisitionSchema) {}
