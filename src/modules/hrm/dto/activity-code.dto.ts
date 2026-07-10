import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createActivityCodeSchema = z.object({
  activityName: z.string().min(1, 'Name is required').max(255),
  activityCode: z.string().max(255).optional(),
});
export class CreateActivityCodeDto extends createZodDto(createActivityCodeSchema) {}
export class UpdateActivityCodeDto extends createZodDto(createActivityCodeSchema.partial()) {}
