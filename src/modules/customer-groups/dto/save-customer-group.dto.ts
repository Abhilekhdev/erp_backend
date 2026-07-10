import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Create/Update payload for a Customer Group — mirrors GOURI_DEV
 * CustomerGroupController@store/@update (`name`, `amount`, `price_calculation_type`,
 * `selling_price_group_id`).
 */
export const saveCustomerGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  price_calculation_type: z.enum(['percentage', 'selling_price_group']).default('percentage'),
  amount: z.coerce.number().min(0).max(999.99).nullish(),
  selling_price_group_id: z.coerce.number().int().positive().nullish(),
});

export type SaveCustomerGroupInput = z.infer<typeof saveCustomerGroupSchema>;

export class SaveCustomerGroupDto extends createZodDto(saveCustomerGroupSchema) {}
