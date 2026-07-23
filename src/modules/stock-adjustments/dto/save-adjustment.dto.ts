import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const saveAdjustmentSchema = z.object({
  location_id: z.coerce.number().int(),
  ref_no: z.string().max(191).optional(),
  transaction_date: z.coerce.date().optional(),
  /** A wastage_types.id (GOURI stores it in `adjustment_type`). */
  adjustment_type_id: z.coerce.number().int().nullish(),
  total_amount_recovered: z.coerce.number().min(0).optional(),
  additional_notes: z.string().max(2000).nullish(),
  products: z
    .array(
      z.object({
        product_id: z.coerce.number().int(),
        variation_id: z.coerce.number().int(),
        quantity: z.coerce.number().positive('Quantity must be greater than zero'),
        unit_price: z.coerce.number().min(0).optional().default(0),
        lot_no_line_id: z.coerce.number().int().nullish(),
      }),
    )
    .min(1, 'Add at least one product'),
});

export class SaveAdjustmentDto extends createZodDto(saveAdjustmentSchema) {}

export interface AdjustmentsQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  locationId?: string;
}
