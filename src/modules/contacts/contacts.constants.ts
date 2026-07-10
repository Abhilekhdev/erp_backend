/**
 * Contacts constants — verified against GOURI_DEV Contact model + ContactController.
 */

/** Contact types manageable from this module (CRM "lead" is out of scope here). */
export const CONTACT_TYPES = ['supplier', 'customer', 'both'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_STATUSES = ['active', 'inactive'] as const;

/** Which stored `type` values a list should include (both = supplier & customer). */
export function typesFor(listType: 'supplier' | 'customer'): string[] {
  return listType === 'supplier' ? ['supplier', 'both'] : ['customer', 'both'];
}

/**
 * Format a contact reference code, mirroring GOURI Util::generateReferenceNumber('contacts', ...):
 * `prefix + zero-padded(count, 4)` — no year segment for the `contacts` ref type.
 */
export function formatContactId(prefix: string, count: number): string {
  return `${prefix}${String(count).padStart(4, '0')}`;
}
