import { round4 } from '../purchases/purchase.calc';

export { round4 };

/**
 * The sell arithmetic, computed SERVER-SIDE.
 *
 * GOURI trusts the browser here in two ways we deliberately fix: it stores `final_total` and each
 * line's `unit_price_inc_tax` / `item_tax` exactly as the page sent them, never re-deriving tax
 * from `tax_id` and never adding shipping / expenses / round-off into `final_total` on the server.
 * Everything below is recomputed from the quantities, the ex-tax unit price the user typed, and the
 * tax RATE — so a crafted request cannot book a sell at a total of its choosing.
 *
 * One naming trap carried over for DB portability: GOURI's `total_before_tax` on a sell is actually
 * the line subtotal INCLUDING each line's own tax (it sums `unit_price_inc_tax`). We keep the column
 * name but call the value `lineSubtotal`, as on purchases.
 */

export type DiscountKind = 'fixed' | 'percentage' | '' | null | undefined;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

export interface SellLineInput {
  quantity: number | string;
  /** The ex-tax selling price the user typed, in the ENTERED unit. */
  unitPrice: number | string;
  lineDiscountType?: DiscountKind;
  lineDiscountAmount?: number | string;
  /** Line tax rate as a percentage; 0 when no tax. */
  taxPercent: number;
  /** >1 when selling in a sub-unit. */
  multiplier?: number;
}

export interface CalculatedSellLine {
  /** Ex-tax list price, per BASE unit, before the line discount. */
  unitPriceBeforeDiscount: number;
  /** Ex-tax, per BASE unit, after the line discount. */
  unitPrice: number;
  /** Tax for ONE base unit. */
  itemTax: number;
  /** Inc-tax, per BASE unit, after the line discount. */
  unitPriceIncTax: number;
  lineDiscountAmount: number;
  /** Quantity in the product's BASE unit. */
  baseQuantity: number;
  /** baseQuantity × unitPriceIncTax — what document totals sum. */
  lineTotal: number;
}

/** One line. The line discount is applied to the ex-tax price; tax is added on top. */
export function calcSellLine(line: SellLineInput): CalculatedSellLine {
  const multiplier = line.multiplier && line.multiplier > 0 ? line.multiplier : 1;
  const listPrice = num(line.unitPrice) / multiplier;
  const quantity = num(line.quantity) * multiplier;
  const discAmount = num(line.lineDiscountAmount);

  let unitPrice = listPrice;
  if (line.lineDiscountType === 'fixed') unitPrice = listPrice - discAmount / multiplier;
  else if (line.lineDiscountType === 'percentage') unitPrice = listPrice * (1 - discAmount / 100);
  unitPrice = Math.max(0, unitPrice);

  const itemTax = (num(line.taxPercent) / 100) * unitPrice;
  const unitPriceIncTax = unitPrice + itemTax;

  return {
    unitPriceBeforeDiscount: round4(listPrice),
    unitPrice: round4(unitPrice),
    itemTax: round4(itemTax),
    unitPriceIncTax: round4(unitPriceIncTax),
    lineDiscountAmount: round4(line.lineDiscountType === 'fixed' ? discAmount / multiplier : discAmount),
    baseQuantity: round4(quantity),
    lineTotal: round4(quantity * unitPriceIncTax),
  };
}

export interface SellTotalsInput {
  /** Σ of line totals, each already INCLUDING its line tax. */
  lineSubtotal: number;
  discountType?: DiscountKind;
  discountAmount: number | string;
  orderTaxPercent: number;
  shippingCharges: number | string;
  additionalExpenses?: { name: string; amount: number | string }[];
  /** Adjustment to reach a round figure; may be negative. */
  roundOff?: number | string;
}

export interface CalculatedSellTotals {
  lineSubtotal: number;
  discount: number;
  taxAmount: number;
  additionalExpenseTotal: number;
  finalTotal: number;
}

/**
 * Document totals. Order matches GOURI: order discount on the (tax-inclusive) line subtotal, then
 * order tax on (subtotal − discount), then shipping + landed costs + round-off added on top.
 */
export function calcSellTotals(input: SellTotalsInput): CalculatedSellTotals {
  const lineSubtotal = round4(input.lineSubtotal);
  const discAmount = num(input.discountAmount);

  const discount =
    input.discountType === 'fixed'
      ? discAmount
      : input.discountType === 'percentage'
        ? (discAmount / 100) * lineSubtotal
        : 0;

  const taxAmount = (num(input.orderTaxPercent) / 100) * (lineSubtotal - discount);
  const additionalExpenseTotal = (input.additionalExpenses ?? []).reduce((s, e) => s + num(e.amount), 0);

  const finalTotal =
    lineSubtotal - discount + taxAmount + num(input.shippingCharges) + additionalExpenseTotal + num(input.roundOff);

  return {
    lineSubtotal,
    discount: round4(discount),
    taxAmount: round4(taxAmount),
    additionalExpenseTotal: round4(additionalExpenseTotal),
    finalTotal: round4(finalTotal),
  };
}
