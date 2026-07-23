import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);

export const contactLedgerQuerySchema = z.object({
  dateFrom: z.preprocess(blank, z.coerce.date().optional()),
  dateTo: z.preprocess(blank, z.coerce.date().optional()),
  locationId: z.preprocess(blank, z.coerce.number().int().positive().optional()),
});

export class ContactLedgerQueryDto extends createZodDto(contactLedgerQuerySchema) {}
