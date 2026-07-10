import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optStr = z.string().optional();
const optionalNumber = (inner: z.ZodTypeAny = z.coerce.number()) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), inner.optional());

/**
 * A sales commission agent is a User row with `is_cmmsn_agnt = true` and `allow_login = false`
 * (mirrors GOURI_DEV SalesCommissionAgentController). Only these columns are ever set here.
 * NOTE: the modern schema makes `email` required + unique (it's the login id), so — unlike legacy,
 * which allowed a blank email — an agent must have a unique email.
 */
export const createCommissionAgentSchema = z.object({
  surname: z.string().max(10).optional(),
  firstName: z.string().min(1, 'First name is required').max(191),
  lastName: optStr,
  email: z.string().min(1, 'Email is required').email('Enter a valid email').max(191),
  contactNo: z.string().max(15).optional(),
  address: optStr,
  cmmsnPercent: optionalNumber(
    z.coerce.number().min(0, 'Commission cannot be negative').max(100, 'Commission cannot exceed 100%'),
  ),
});

export class CreateCommissionAgentDto extends createZodDto(createCommissionAgentSchema) {}
export class UpdateCommissionAgentDto extends createZodDto(createCommissionAgentSchema.partial()) {}
