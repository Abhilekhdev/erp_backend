import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optStr = z.string().optional();

/**
 * Optional date-of-birth. A native <input type="date"> can emit a 5+ digit year (e.g. "99999-07-05"),
 * which then blows up when Postgres tries to store it — so validate a real 4-digit-year calendar date
 * in range [1900, today] and return a friendly message instead of a 500.
 */
const optionalDob = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date of birth (YYYY-MM-DD, 4-digit year)')
    .refine((s) => {
      const [y, m, d] = s.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      // Reject non-calendar dates (e.g. Feb 30 → rolls over), years before 1900, and future dates.
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d &&
        y >= 1900 &&
        dt.getTime() <= Date.now()
      );
    }, 'Enter a valid date of birth (4-digit year, not in the future)')
    .optional(),
);
// A numeric field coming from an HTML form: '' | null | undefined means "not provided" (→ undefined),
// anything else is coerced and validated by `inner`. This prevents both Number('') === 0 AND
// coerce(undefined) === NaN (the bug where an empty commission/discount box failed validation).
const optionalNumber = (inner: z.ZodTypeAny = z.coerce.number()) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), inner.optional());

// Like optionalNumber but preserves an explicit null: '' / absent → skip (undefined), null → clear,
// value → coerce. Used for optional FK-style fields the UI can set OR clear (manager, dept, location…).
const nullableNumber = (inner: z.ZodTypeAny = z.coerce.number()) =>
  z.preprocess((v) => (v === '' || v === undefined ? undefined : v), inner.nullable().optional());

export const createUserSchema = z.object({
  // Identity
  surname: z.string().max(10).optional(),
  firstName: z.string().min(1, 'First name is required').max(191),
  lastName: optStr,
  email: z.string().min(1, 'Email is required').email('Enter a valid email').max(191),

  // Login. Password is optional at the schema level (edit keeps the current one, non-login users have
  // none) but, WHEN present, must be strong. `create()` separately requires it for a login-enabled user.
  username: optStr,
  password: z
    .string()
    .max(191)
    .optional()
    .refine((v) => !v || v.length >= 8, { message: 'Password must be at least 8 characters' })
    .refine((v) => !v || /[A-Za-z]/.test(v), { message: 'Password must include at least one letter' })
    .refine((v) => !v || /\d/.test(v), { message: 'Password must include at least one number' })
    .refine((v) => !v || /[^A-Za-z0-9]/.test(v), {
      message: 'Password must include at least one special character (e.g. !@#$%)',
    }),
  allowLogin: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),

  // Role & access
  roleId: z.coerce.number({ invalid_type_error: 'Select a role' }).int().positive('Select a role'),
  accessAllLocations: z.boolean().optional().default(false),
  locationIds: z.array(z.coerce.number().int().positive()).optional().default([]),

  // Sales / hierarchy — is_cmmsn_agnt is intentionally NOT settable here (commission agents are a separate module).
  cmmsnPercent: optionalNumber(
    z.coerce.number().min(0, 'Commission cannot be negative').max(100, 'Commission cannot exceed 100%'),
  ),
  maxSalesDiscountPercent: optionalNumber(
    z.coerce.number().min(0, 'Discount cannot be negative').max(100, 'Discount cannot exceed 100%'),
  ),
  // Manager (parent_id): '' / absent → skip on update; explicit null → clear; positive int → set.
  parentId: nullableNumber(z.coerce.number().int().positive()),

  // Employment (HRM / Essentials)
  essentialsDepartmentId: nullableNumber(z.coerce.number().int().positive()),
  essentialsDesignationId: nullableNumber(z.coerce.number().int().positive()),
  essentialsSalary: nullableNumber(z.coerce.number().min(0, 'Salary cannot be negative')),
  essentialsPayPeriod: z.preprocess(
    (v) => (v === '' ? null : v),
    z.enum(['month', 'week', 'day']).nullable().optional(),
  ),
  locationId: nullableNumber(z.coerce.number().int().positive()), // primary work location

  // HRM multi-selects (parity with legacy Essentials user_form_part). Always sent by the full-form
  // UI, so an empty array means "clear all", matching how locationIds/contactIds behave here.
  activityCodes: z.array(z.coerce.number().int().positive()).optional().default([]),
  payComponents: z.array(z.coerce.number().int().positive()).optional().default([]),
  leaveTypeIds: z.array(z.coerce.number().int().positive()).optional().default([]),

  // Profile
  dob: optionalDob,
  gender: optStr,
  maritalStatus: optStr,
  bloodGroup: optStr,
  contactNumber: optStr,
  altNumber: optStr,
  familyNumber: optStr,
  fbLink: optStr,
  twitterLink: optStr,
  socialMedia1: optStr,
  socialMedia2: optStr,
  customField1: optStr,
  customField2: optStr,
  customField3: optStr,
  customField4: optStr,
  guardianName: optStr,
  idProofName: optStr,
  idProofNumber: optStr,
  permanentAddress: optStr,
  currentAddress: optStr,

  // Bank
  bankDetails: z
    .object({
      accountHolderName: optStr,
      accountNumber: optStr,
      bankName: optStr,
      bankCode: optStr,
      branch: optStr,
      taxPayerId: optStr,
    })
    .optional(),

  // Contacts
  selectedContacts: z.boolean().optional().default(false),
  contactIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

export class CreateUserDto extends createZodDto(createUserSchema) {}
