import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const money = z.preprocess(blank, z.coerce.number().min(0).optional().default(0));
const optStr = z.preprocess(blank, z.string().max(191).optional());

export const SHIPPING_STATUSES = ['ordered', 'packed', 'shipped', 'delivered', 'cancelled'] as const;

export const purchaseOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  /** Matches reference number or supplier name. */
  search: z.string().optional().default(''),
  locationId: optId,
  contactId: optId,
  status: z.preprocess(blank, z.enum(['ordered', 'partial', 'completed']).optional()),
  shippingStatus: z.preprocess(blank, z.enum(SHIPPING_STATUSES).optional()),
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
});

export class PurchaseOrdersQueryDto extends createZodDto(purchaseOrdersQuerySchema) {}

/**
 * One ordered line. As with a purchase, only what the user typed is accepted; every derived
 * figure is recomputed server-side. GOURI takes `final_total`, `tax_amount` and each line price
 * straight from the request here too.
 */
export const purchaseOrderLineSchema = z.object({
  /** Set when editing — lets the server update the row in place instead of replacing it. */
  purchase_line_id: optId,
  /** The requisition line this fulfils, when the order was raised from one. */
  purchase_requisition_line_id: optId,
  product_id: z.coerce.number().int().positive(),
  variation_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  sub_unit_id: optId,
  secondary_unit_quantity: money,
  pp_without_discount: money,
  discount_percent: z.preprocess(blank, z.coerce.number().min(0).max(100).optional().default(0)),
  tax_rate_id: optId,
});

export const savePurchaseOrderSchema = z.object({
  contact_id: z.coerce.number().int().positive('Select a supplier'),
  location_id: z.coerce.number().int().positive('Select a business location'),
  ref_no: optStr,
  transaction_date: z.string().min(1, 'Order date is required'),
  /** When the goods are expected. */
  delivery_date: z.preprocess(blank, z.string().optional()),

  pay_term_number: z.preprocess(blank, z.coerce.number().int().min(0).optional()),
  pay_term_type: z.preprocess(blank, z.enum(['days', 'months']).optional()),

  discount_type: z.preprocess(blank, z.enum(['fixed', 'percentage']).optional()),
  discount_amount: money,
  tax_rate_id: optId,

  shipping_details: optStr,
  shipping_address: z.preprocess(blank, z.string().optional()),
  shipping_charges: money,
  shipping_status: z.preprocess(blank, z.enum(SHIPPING_STATUSES).optional()),
  delivered_to: optStr,
  additional_expenses: z
    .array(z.object({ name: z.string().max(191), amount: z.coerce.number().min(0) }))
    .optional(),

  exchange_rate: z.preprocess(blank, z.coerce.number().positive().optional().default(1)),
  additional_notes: z.preprocess(blank, z.string().optional()),
  custom_field_1: optStr,
  custom_field_2: optStr,
  custom_field_3: optStr,
  custom_field_4: optStr,

  /** Requisitions this order draws down. */
  purchase_requisition_ids: z.array(z.coerce.number().int().positive()).optional(),
  purchases: z.array(purchaseOrderLineSchema).min(1, 'Add at least one product'),
});

export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;
export class SavePurchaseOrderDto extends createZodDto(savePurchaseOrderSchema) {}

export const updateShippingSchema = z.object({
  shipping_status: z.enum(SHIPPING_STATUSES),
  delivered_to: optStr,
  shipping_address: z.preprocess(blank, z.string().optional()),
  delivery_date: z.preprocess(blank, z.string().optional()),
});
export class UpdateShippingDto extends createZodDto(updateShippingSchema) {}
