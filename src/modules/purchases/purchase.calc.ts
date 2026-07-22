import type { PurchaseLineInput } from './dto/save-purchase.dto';

/**
 * The purchase arithmetic, ported 1:1 from GOURI's `update_grand_total()` / the line handlers in
 * `public/js/purchase.js`.
 *
 * It lives server-side because GOURI's does not: its controller takes `final_total`, `tax_amount`
 * and every line price straight from the request and only scales them by the exchange rate
 * (`PurchaseController.php:355-368`). The browser is the only thing that ever computes a purchase
 * total there, so a crafted POST can book any number it likes.
 *
 * Money is kept as plain numbers here and rounded to 4dp on the way out, matching the Decimal(22,4)
 * columns. Everything is expressed in the ENTERED currency; the caller multiplies by the exchange
 * rate once, at the end, because that is the point where GOURI converts too.
 */

/** 4dp is the column precision; without this, 0.1 + 0.2 style drift reaches the database. */
export const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

export interface CalculatedLine {
  /** Price after the line discount, before tax. */
  purchasePrice: number;
  /** Tax for ONE unit — GOURI's `item_tax` means per-unit, not per-line. */
  itemTax: number;
  purchasePriceIncTax: number;
  /** quantity x purchasePrice */
  lineSubtotalBeforeTax: number;
  /** quantity x purchasePriceIncTax */
  lineTotal: number;
}

/**
 * One line. Line tax is EXCLUSIVE — added on top of the discounted price.
 *
 * `quantity` is already in the product's base unit (the caller multiplies out any sub-unit), and
 * `discountPercent` is never scaled by the exchange rate, both as GOURI does.
 */
export function calcLine(
  line: Pick<PurchaseLineInput, 'quantity' | 'pp_without_discount' | 'discount_percent'>,
  taxPercent: number,
): CalculatedLine {
  const listPrice = Number(line.pp_without_discount) || 0;
  const discountPercent = Number(line.discount_percent) || 0;
  const quantity = Number(line.quantity) || 0;

  const purchasePrice = listPrice - (discountPercent / 100) * listPrice;
  const itemTax = (taxPercent / 100) * purchasePrice;
  const purchasePriceIncTax = purchasePrice + itemTax;

  return {
    purchasePrice: round4(purchasePrice),
    itemTax: round4(itemTax),
    purchasePriceIncTax: round4(purchasePriceIncTax),
    lineSubtotalBeforeTax: round4(quantity * purchasePrice),
    lineTotal: round4(quantity * purchasePriceIncTax),
  };
}

export interface TotalsInput {
  /** Σ of every line total (each already INCLUDING its own line tax). */
  lineSubtotal: number;
  discountType?: 'fixed' | 'percentage';
  discountAmount: number;
  /** The order-level tax rate, as a percentage. */
  orderTaxPercent: number;
  shippingCharges: number;
  additionalExpenses?: { name: string; amount: number }[];
}

export interface CalculatedTotals {
  lineSubtotal: number;
  discount: number;
  taxAmount: number;
  additionalExpenseTotal: number;
  finalTotal: number;
}

/**
 * Document totals.
 *
 * Order of operations matters and matches GOURI exactly: the order-level tax is charged on the
 * subtotal AFTER the discount, and shipping + landed costs are added after tax (they are not taxed).
 */
export function calcTotals(input: TotalsInput): CalculatedTotals {
  const lineSubtotal = round4(input.lineSubtotal);

  const discount =
    input.discountType === 'fixed'
      ? Number(input.discountAmount) || 0
      : input.discountType === 'percentage'
        ? ((Number(input.discountAmount) || 0) / 100) * lineSubtotal
        : 0;

  const taxAmount = ((Number(input.orderTaxPercent) || 0) / 100) * (lineSubtotal - discount);
  const additionalExpenseTotal = (input.additionalExpenses ?? []).reduce(
    (sum, e) => sum + (Number(e.amount) || 0),
    0,
  );

  const finalTotal =
    lineSubtotal - discount + taxAmount + (Number(input.shippingCharges) || 0) + additionalExpenseTotal;

  return {
    lineSubtotal,
    discount: round4(discount),
    taxAmount: round4(taxAmount),
    additionalExpenseTotal: round4(additionalExpenseTotal),
    finalTotal: round4(finalTotal),
  };
}

/**
 * Paid-versus-owed, from GOURI's `calculatePaymentStatus`.
 * Overpaying still reads PAID — there is no "overpaid" state.
 */
export function paymentStatusFor(finalTotal: number, totalPaid: number): 'PAID' | 'PARTIAL' | 'DUE' {
  if (totalPaid >= finalTotal) return 'PAID';
  if (totalPaid > 0) return 'PARTIAL';
  return 'DUE';
}
