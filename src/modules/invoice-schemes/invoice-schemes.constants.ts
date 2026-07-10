/**
 * Invoice scheme constants — verified against GOURI_DEV invoice_scheme views + config/constants.php.
 */

/** `config('constants.invoice_scheme_separator')` — joins year and running number in `year` schemes. */
export const INVOICE_SCHEME_SEPARATOR = '-';

/** total_digits select options (GOURI create/edit blade: 4..10). */
export const TOTAL_DIGITS_OPTIONS = [4, 5, 6, 7, 8, 9, 10];

/**
 * Build the invoice-number preview for a scheme, mirroring GOURI's live preview + list `prefix`
 * column. `year` schemes render `prefix + YYYY + separator + zero-padded(start_number)`.
 */
export function previewInvoiceNumber(
  schemeType: 'blank' | 'year',
  prefix: string | null,
  startNumber: number | null,
  totalDigits: number | null,
  year: number,
): string {
  const p = prefix ?? '';
  const digits = totalDigits ?? 4;
  const num = String(startNumber ?? 0).padStart(digits, '0');
  if (schemeType === 'year') {
    return `${p}${year}${INVOICE_SCHEME_SEPARATOR}${num}`;
  }
  return `${p}${num}`;
}
