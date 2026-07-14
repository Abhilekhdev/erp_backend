import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** GOURI_DEV SellingPriceGroupController@store/@update — name + description. */
export const saveSellingPriceGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().nullish(),
});

export class SaveSellingPriceGroupDto extends createZodDto(saveSellingPriceGroupSchema) {}
