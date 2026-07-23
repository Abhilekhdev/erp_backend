import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const money = z.preprocess(blank, z.coerce.number().min(0).optional().default(0));
const optStr = z.preprocess(blank, z.string().max(191).optional());

export const salesOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().optional().default(''),
  locationId: optId,
  contactId: optId,
  status: z.preprocess(blank, z.enum(['ordered', 'partial', 'completed']).optional()),
  shippingStatus: z.preprocess(blank, z.enum(['ordered', 'packed', 'shipped', 'delivered', 'cancelled']).optional()),
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
});
export class SalesOrdersQueryDto extends createZodDto(salesOrdersQuerySchema) {}

export const salesOrderLineSchema = z.object({
  sell_line_id: optId,
  product_id: z.coerce.number().int().positive(),
  variation_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  sub_unit_id: optId,
  unit_price: z.preprocess(blank, z.coerce.number().min(0).optional()),
  line_discount_type: z.preprocess(blank, z.enum(['fixed', 'percentage']).optional()),
  line_discount_amount: money,
  tax_rate_id: optId,
});

export const saveSalesOrderSchema = z.object({
  contact_id: z.coerce.number().int().positive('Select a customer'),
  location_id: z.coerce.number().int().positive('Select a business location'),
  ref_no: optStr,
  transaction_date: z.string().min(1, 'Order date is required'),
  delivery_date: z.preprocess(blank, z.string().optional()),
  pay_term_number: z.preprocess(blank, z.coerce.number().int().min(0).optional()),
  pay_term_type: z.preprocess(blank, z.enum(['days', 'months']).optional()),
  discount_type: z.preprocess(blank, z.enum(['fixed', 'percentage']).optional()),
  discount_amount: money,
  tax_rate_id: optId,
  shipping_details: optStr,
  shipping_address: z.preprocess(blank, z.string().optional()),
  shipping_charges: money,
  shipping_status: z.preprocess(blank, z.enum(['ordered', 'packed', 'shipped', 'delivered', 'cancelled']).optional()),
  delivered_to: optStr,
  additional_expenses: z.array(z.object({ name: z.string().max(191), amount: z.coerce.number().min(0) })).optional(),
  round_off_amount: z.preprocess(blank, z.coerce.number().optional().default(0)),
  additional_notes: z.preprocess(blank, z.string().optional()),
  sells: z.array(salesOrderLineSchema).min(1, 'Add at least one product'),
});

export type SalesOrderLineInput = z.infer<typeof salesOrderLineSchema>;
export class SaveSalesOrderDto extends createZodDto(saveSalesOrderSchema) {}

export const updateSoShippingSchema = z.object({
  shipping_status: z.enum(['ordered', 'packed', 'shipped', 'delivered', 'cancelled']),
  delivered_to: optStr,
  shipping_address: z.preprocess(blank, z.string().optional()),
  delivery_date: z.preprocess(blank, z.string().optional()),
});
export class UpdateSoShippingDto extends createZodDto(updateSoShippingSchema) {}
