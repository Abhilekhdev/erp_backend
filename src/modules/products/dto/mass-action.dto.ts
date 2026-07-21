import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The selected rows. Every mass action starts from this. */
const ids = z.array(z.coerce.number().int().positive()).min(1, 'Select at least one product');

export const massActionSchema = z.object({ ids });
export class MassActionDto extends createZodDto(massActionSchema) {}

export const massActivateSchema = z.object({ ids, active: z.boolean() });
export class MassActivateDto extends createZodDto(massActivateSchema) {}

export const massLocationsSchema = z.object({
  ids,
  location_ids: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one location'),
  mode: z.enum(['add', 'remove']),
});
export class MassLocationsDto extends createZodDto(massLocationsSchema) {}
