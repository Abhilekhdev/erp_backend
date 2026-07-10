import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Shared DTO for the identical "org list" entities (Departments, Designations).
export const createOrgItemSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  shortCode: z.string().max(255).optional(),
  description: z.string().optional(),
});

export class CreateOrgItemDto extends createZodDto(createOrgItemSchema) {}
export class UpdateOrgItemDto extends createZodDto(createOrgItemSchema.partial()) {}
