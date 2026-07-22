import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const opt = z.string().max(191).optional().or(z.literal(''));

/**
 * Multi-tenant signup: creates a business, its owner (admin) user and the business's first
 * location, in one transaction.
 *
 * Deliberately SHORTER than GOURI's 3-step wizard. Anything a business can change later without
 * consequence does not belong on the first screen a prospect ever sees:
 *  - **start date** is the registration date (Settings → Business can change it);
 *  - **logo** is uploaded from Business Settings, where the preview and the rest of the branding live;
 *  - **tax labels/numbers, financial year and accounting method** are Settings → Business too, and
 *    all have sane defaults (FY month 1, FIFO).
 * What remains is what we genuinely cannot create the tenant without.
 *
 * Two further differences from GOURI:
 *  - email is REQUIRED and is the login id (GOURI has a separate `username` and lets email be null);
 *  - the address is optional. GOURI marks country/state/city/zip/landmark `required` on a signup
 *    form, which is a lot to demand before anyone has seen the product — we create the first
 *    location from whatever is given and let Settings fill in the rest.
 */
export const registerSchema = z
  .object({
    // ── Step 1: business
    businessName: z.string().min(2, 'Business name is required').max(191),
    currencyId: z.coerce.number().int().positive('Select a currency'),
    website: opt,
    mobile: opt,
    alternateNumber: opt,
    country: opt,
    state: opt,
    city: opt,
    zipCode: z.string().max(20).optional().or(z.literal('')),
    landmark: opt,
    timeZone: z.string().max(191).optional(),

    // ── Step 2: owner
    ownerSurname: z.string().max(10).optional().or(z.literal('')), // salutation e.g. Mr/Ms
    ownerFirstName: z.string().min(1, 'First name is required').max(191),
    ownerLastName: opt,
    email: z.string().min(1, 'Email is required').email('Enter a valid email').max(191),
    password: z.string().min(8, 'Use at least 8 characters').max(191),
    /** Optional so API clients aren't forced into it, but checked when sent — GOURI never checks it. */
    confirmPassword: z.string().optional(),
  })
  .refine((d) => !d.confirmPassword || d.confirmPassword === d.password, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export class RegisterDto extends createZodDto(registerSchema) {}
