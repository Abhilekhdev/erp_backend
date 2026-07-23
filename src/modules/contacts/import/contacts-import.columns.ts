/**
 * The contacts import file specification — verified 1:1 against GOURI_DEV
 * `resources/views/contact/import.blade.php` (the instructions table) and
 * `ContactController::postImportContacts` (`$value[0]`…`$value[26]`), plus the shipped
 * `public/files/import_contacts_csv_template.xls`, whose 27 headers match exactly.
 *
 * ONE source of truth: the template generator, the parser and the on-screen instructions all read
 * this array. GOURI keeps the spec in the blade and the rules in the controller, which is exactly
 * how they drifted apart — the view says "Business name required for supplier" and "DOB format
 * Y-m-d" while the code enforces neither.
 */

export type Requirement = 'required' | 'optional' | 'supplier' | 'documented-only';

export interface ImportColumn {
  /** 1-based position in the file. The order is load-bearing — do not reorder. */
  index: number;
  /** Header text written to the template. */
  header: string;
  /** Field name in the parsed row. */
  key: string;
  /**
   * `required`        — rejected when blank
   * `supplier`        — required only when the row's contact type is supplier or both
   * `optional`        — free
   * `documented-only` — GOURI's instructions call it required but its code never checks; we warn
   *                     rather than reject, so files that import into GOURI still import here.
   */
  requirement: Requirement;
  /** Shown in the on-screen instructions table. */
  help: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { index: 1, header: 'CONTACT TYPE', key: 'type', requirement: 'required', help: '1 = Customer, 2 = Supplier, 3 = Both' },
  { index: 2, header: 'PREFIX', key: 'prefix', requirement: 'optional', help: 'e.g. Mr, Mrs, Dr' },
  { index: 3, header: 'FIRST NAME', key: 'first_name', requirement: 'required', help: '' },
  { index: 4, header: 'MIDDLE NAME', key: 'middle_name', requirement: 'optional', help: '' },
  { index: 5, header: 'LAST NAME', key: 'last_name', requirement: 'optional', help: '' },
  { index: 6, header: 'BUSINESS NAME', key: 'supplier_business_name', requirement: 'documented-only', help: 'Required if contact type is Supplier or Both' },
  { index: 7, header: 'CONTACT ID', key: 'contact_id', requirement: 'optional', help: 'Leave blank to auto-generate. Must be unique.' },
  { index: 8, header: 'TAX NUMBER', key: 'tax_number', requirement: 'optional', help: '' },
  { index: 9, header: 'OPENING BALANCE', key: 'opening_balance', requirement: 'optional', help: 'What the contact already owed (customer) or was owed (supplier) at start' },
  { index: 10, header: 'PAY TERM', key: 'pay_term_number', requirement: 'supplier', help: 'Number. Required if contact type is Supplier or Both' },
  { index: 11, header: 'PAY TERM PERIOD', key: 'pay_term_type', requirement: 'supplier', help: 'days or months. Required if contact type is Supplier or Both' },
  { index: 12, header: 'CREDIT LIMIT', key: 'credit_limit', requirement: 'optional', help: 'Applies to Customer / Both only' },
  { index: 13, header: 'EMAIL', key: 'email', requirement: 'optional', help: '' },
  { index: 14, header: 'MOBILE', key: 'mobile', requirement: 'required', help: '' },
  { index: 15, header: 'ALT. CONTACT NO.', key: 'alternate_number', requirement: 'optional', help: '' },
  { index: 16, header: 'LANDLINE', key: 'landline', requirement: 'optional', help: '' },
  { index: 17, header: 'CITY', key: 'city', requirement: 'optional', help: '' },
  { index: 18, header: 'STATE', key: 'state', requirement: 'optional', help: '' },
  { index: 19, header: 'COUNTRY', key: 'country', requirement: 'optional', help: '' },
  { index: 20, header: 'ADDRESS LINE 1', key: 'address_line_1', requirement: 'optional', help: '' },
  { index: 21, header: 'ADDRESS LINE 2', key: 'address_line_2', requirement: 'optional', help: '' },
  { index: 22, header: 'ZIP CODE', key: 'zip_code', requirement: 'optional', help: '' },
  { index: 23, header: 'DOB', key: 'dob', requirement: 'optional', help: 'Format: YYYY-MM-DD (a real Excel date cell also works)' },
  { index: 24, header: 'CUSTOM FIELD 1', key: 'custom_field1', requirement: 'optional', help: '' },
  { index: 25, header: 'CUSTOM FIELD 2', key: 'custom_field2', requirement: 'optional', help: '' },
  { index: 26, header: 'CUSTOM FIELD 3', key: 'custom_field3', requirement: 'optional', help: '' },
  { index: 27, header: 'CUSTOM FIELD 4', key: 'custom_field4', requirement: 'optional', help: '' },
];

export const COLUMN_COUNT = IMPORT_COLUMNS.length;

/** Column 1 is the digit, not the word — GOURI stores the mapped word (`ContactController.php:1065-1069`). */
export const CONTACT_TYPE_MAP: Record<string, 'customer' | 'supplier' | 'both'> = {
  '1': 'customer',
  '2': 'supplier',
  '3': 'both',
};

/** One example row, so the template shows the expected shape instead of an empty grid. */
export const TEMPLATE_SAMPLE_ROW: string[] = [
  '1', 'Mr', 'Asha', '', 'Verma', '', '', '', '', '', '', '50000',
  'asha@example.com', '9876543210', '', '', 'Pune', 'Maharashtra', 'India',
  '12 MG Road', '', '411001', '1990-05-24', '', '', '', '',
];
