import { createZodDto } from 'nestjs-zod';
import { createRoleSchema } from './create-role.dto';

export class UpdateRoleDto extends createZodDto(createRoleSchema.partial()) {}
