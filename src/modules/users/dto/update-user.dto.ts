import { createZodDto } from 'nestjs-zod';
import { createUserSchema } from './create-user.dto';

export class UpdateUserDto extends createZodDto(createUserSchema.partial()) {}
