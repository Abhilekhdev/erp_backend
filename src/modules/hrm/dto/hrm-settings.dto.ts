import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().min(0).optional(),
);

export const updateHrmSettingsSchema = z.object({
  leaveRefNoPrefix: z.string().optional(),
  leaveInstructions: z.string().optional(),
  payrollRefNoPrefix: z.string().optional(),
  isLocationRequired: z.boolean().optional().default(false),
  graceBeforeCheckin: optNum,
  graceAfterCheckin: optNum,
  graceBeforeCheckout: optNum,
  graceAfterCheckout: optNum,
  calculateSalesTargetCommissionWithoutTax: z.boolean().optional().default(false),
  essentialsTodosPrefix: z.string().optional(),
});
export class UpdateHrmSettingsDto extends createZodDto(updateHrmSettingsSchema) {}
