import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TRANSFER_STATUSES = ['pending', 'in_transit', 'completed'] as const;

export const saveTransferSchema = z
  .object({
    transaction_date: z.coerce.date().optional(),
    ref_no: z.string().max(191).optional(),
    status: z.enum(TRANSFER_STATUSES),
    location_id: z.coerce.number().int(), // FROM
    transfer_location_id: z.coerce.number().int(), // TO
    shipping_charges: z.coerce.number().min(0).optional().default(0),
    additional_notes: z.string().max(2000).nullish(),
    products: z
      .array(
        z.object({
          product_id: z.coerce.number().int(),
          variation_id: z.coerce.number().int(),
          quantity: z.coerce.number().positive('Quantity must be greater than zero'),
          unit_price: z.coerce.number().min(0).optional().default(0),
        }),
      )
      .min(1, 'Add at least one product'),
  })
  .refine((d) => d.location_id !== d.transfer_location_id, {
    message: 'The source and destination locations must be different',
    path: ['transfer_location_id'],
  });

export class SaveTransferDto extends createZodDto(saveTransferSchema) {}

export const updateTransferStatusSchema = z.object({
  status: z.enum(TRANSFER_STATUSES),
});
export class UpdateTransferStatusDto extends createZodDto(updateTransferStatusSchema) {}
