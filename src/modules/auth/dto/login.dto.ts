import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional().default(false),
});

export class LoginDto extends createZodDto(loginSchema) {}
