import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** GOURI_DEV WarrantyController@store/@update — name, description, duration, duration_type. */
export const saveWarrantySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().nullish(),
  duration: z.coerce.number().int().positive('Duration must be a positive number'),
  duration_type: z.enum(['days', 'months', 'years']).default('months'),
});

export class SaveWarrantyDto extends createZodDto(saveWarrantySchema) {}
