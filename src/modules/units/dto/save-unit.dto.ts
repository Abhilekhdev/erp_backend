import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// GOURI stores allow_decimal from a yes/no select — accept boolean, '1'/'0', 'true'/'false'.
const boolish = z.preprocess(
  (v) => v === true || v === 1 || v === '1' || v === 'true',
  z.boolean(),
);
// Optional numeric that treats ''/null/undefined as "not provided".
const optNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().positive().optional(),
);
const optId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

/**
 * Create/Update payload for a Unit — mirrors GOURI_DEV UnitController@store/@update
 * (actual_name, short_name, allow_decimal, and the optional base-unit fields for sub-units).
 * A unit becomes a SUB-UNIT only when both base_unit_id and a non-zero multiplier are supplied.
 */
export const saveUnitSchema = z.object({
  actual_name: z.string().min(1, 'Name is required').max(255),
  short_name: z.string().min(1, 'Short name is required').max(255),
  allow_decimal: boolish.default(false),
  base_unit_id: optId,
  base_unit_multiplier: optNum,
});

export type SaveUnitInput = z.infer<typeof saveUnitSchema>;

export class SaveUnitDto extends createZodDto(saveUnitSchema) {}
