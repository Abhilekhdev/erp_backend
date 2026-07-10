import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createRoleSchema = z.object({
  name: z.string().min(1, 'Role name is required').max(191),
  isServiceStaff: z.boolean().optional().default(false),
  /** Flat list of permission names (frontend flattens checkbox + radio selections). */
  permissions: z.array(z.string()).optional().default([]),
});

export class CreateRoleDto extends createZodDto(createRoleSchema) {}
