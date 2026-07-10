import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Multi-tenant signup: creates a business + its owner (admin) user in one transaction. */
export const registerSchema = z.object({
  businessName: z.string().min(2, 'Business name is required').max(191),
  ownerFirstName: z.string().min(1, 'First name is required').max(191),
  ownerLastName: z.string().max(191).optional().or(z.literal('')),
  ownerSurname: z.string().max(10).optional().or(z.literal('')), // salutation e.g. Mr/Ms
  email: z.string().min(1, 'Email is required').email('Enter a valid email').max(191),
  password: z.string().min(8, 'Use at least 8 characters').max(191),
  currencyId: z.coerce.number().int().positive('Select a currency'),
  timeZone: z.string().max(191).optional(),
  fyStartMonth: z.coerce.number().int().min(1).max(12).optional().default(1),
  accountingMethod: z.enum(['fifo', 'lifo']).optional().default('fifo'),
});

export class RegisterDto extends createZodDto(registerSchema) {}
