/**
 * Payment-method keys + default labels — verified 1:1 against GOURI_DEV `Util::payment_types()`.
 * Labels are overridable per-business via `business.custom_labels.payments.custom_pay_N`
 * (and the built-in `cash`/`card`/… keep their lang_v1 defaults).
 */
export interface PaymentType {
  key: string;
  label: string;
}

/** The fixed payment types, in GOURI order. `create` == the legacy "Create" (credit) method. */
export const BASE_PAYMENT_TYPES: PaymentType[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'create', label: 'Create' },
  { key: 'card', label: 'Card' },
  { key: 'cheque', label: 'Cheque' },
  { key: 'bank_transfer', label: 'Bank Transfer' },
  { key: 'other', label: 'Other' },
];

export const CUSTOM_PAYMENT_COUNT = 7;

/**
 * Build the payment-type list for a business, applying custom_labels overrides — mirrors
 * `Util::payment_types($location=null, $show_advance=false, $business_id)`.
 */
export function buildPaymentTypes(customLabels: unknown): PaymentType[] {
  const labels = (customLabels ?? {}) as Record<string, Record<string, string>>;
  const payments = labels.payments ?? {};
  const list = [...BASE_PAYMENT_TYPES];
  for (let i = 1; i <= CUSTOM_PAYMENT_COUNT; i++) {
    const key = `custom_pay_${i}`;
    list.push({ key, label: payments[key] || `Custom Payment ${i}` });
  }
  return list;
}

/** Location custom-field labels (custom_labels.location.custom_field_N), with lang_v1 defaults. */
export function locationCustomFieldLabels(customLabels: unknown): [string, string, string, string] {
  const labels = (customLabels ?? {}) as Record<string, Record<string, string>>;
  const loc = labels.location ?? {};
  return [
    loc.custom_field_1 || 'Custom field 1',
    loc.custom_field_2 || 'Custom field 2',
    loc.custom_field_3 || 'Custom field 3',
    loc.custom_field_4 || 'Custom field 4',
  ];
}
