/**
 * Static option lists for the Business Settings form — verified 1:1 from GOURI_DEV
 * (BusinessController::getBusinessSettings, Business::date_formats, ModuleUtil::availableModules).
 * `value` is what the API/DB stores; `label` is the English display text.
 */

export const ACCOUNTING_METHODS = [
  { value: 'FIFO', label: 'FIFO (First In First Out)' },
  { value: 'LIFO', label: 'LIFO (Last In First Out)' },
] as const;

export const DATE_FORMATS = [
  { value: 'd-m-Y', label: 'dd-mm-yyyy' },
  { value: 'm-d-Y', label: 'mm-dd-yyyy' },
  { value: 'd/m/Y', label: 'dd/mm/yyyy' },
  { value: 'm/d/Y', label: 'mm/dd/yyyy' },
] as const;

export const TIME_FORMATS = [
  { value: 'H12', label: '12 Hour' },
  { value: 'H24', label: '24 Hour' },
] as const;

export const CURRENCY_SYMBOL_PLACEMENTS = [
  { value: 'BEFORE', label: 'Before amount' },
  { value: 'AFTER', label: 'After amount' },
] as const;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((label, i) => ({ value: i + 1, label }));

export const PRECISIONS = [0, 1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }));

export const SALES_COMMISSION_AGENT_OPTIONS = [
  { value: '', label: 'Disable' },
  { value: 'LOGGED_IN_USER', label: 'Logged in user' },
  { value: 'USER', label: 'Select from users list' },
  { value: 'CMSN_AGNT', label: 'Select from commission agents list' },
] as const;

export const ITEM_ADDITION_METHODS = [
  { value: false, label: 'Add item in new row' },
  { value: true, label: 'Increase item quantity if it already exists' },
] as const;

export const EXPIRY_TYPES = [
  { value: 'ADD_EXPIRY', label: 'Add item expiry' },
  { value: 'ADD_MANUFACTURING', label: 'Add manufacturing date & expiry period' },
] as const;

export const ON_PRODUCT_EXPIRY_OPTIONS = [
  { value: 'KEEP_SELLING', label: 'Keep Selling' },
  { value: 'STOP_SELLING', label: 'Stop Selling n days before' },
] as const;

export const SELL_PRICE_TAX_OPTIONS = [
  { value: 'INCLUDES', label: 'Includes the Sale Tax' },
  { value: 'EXCLUDES', label: 'Excludes the Sale Tax' },
] as const;

export const AMOUNT_ROUNDING_METHODS = [
  { value: '', label: 'None' },
  { value: '1', label: 'Round to nearest whole number' },
  { value: '0.05', label: 'Round to nearest 0.05' },
  { value: '0.1', label: 'Round to nearest 0.1' },
  { value: '0.5', label: 'Round to nearest 0.5' },
] as const;

export const COMMISSION_CALCULATION_TYPES = [
  { value: 'invoice_value', label: 'Invoice value' },
  { value: 'payment_received', label: 'Payment received' },
] as const;

export const CASH_DENOMINATION_ON_OPTIONS = [
  { value: 'pos_screen', label: 'POS screen' },
  { value: 'all_screens', label: 'All screens' },
] as const;

export const RP_EXPIRY_TYPES = [
  { value: 'MONTH', label: 'Month' },
  { value: 'YEAR', label: 'Year' },
] as const;

export const THEME_COLORS = [
  { value: 'blue', label: 'Blue' },
  { value: 'black', label: 'Black' },
  { value: 'purple', label: 'Purple' },
  { value: 'green', label: 'Green' },
  { value: 'red', label: 'Red' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'blue-light', label: 'Blue Light' },
  { value: 'black-light', label: 'Black Light' },
  { value: 'purple-light', label: 'Purple Light' },
  { value: 'green-light', label: 'Green Light' },
  { value: 'red-light', label: 'Red Light' },
] as const;

export const DATATABLE_PAGE_ENTRIES = [
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '200', label: '200' },
  { value: '500', label: '500' },
  { value: '1000', label: '1000' },
  { value: '-1', label: 'All' },
] as const;

/** ModuleUtil::availableModules() — the Modules-tab checkbox list (order preserved). */
export const AVAILABLE_MODULES = [
  { value: 'purchases', label: 'Purchases' },
  { value: 'add_sale', label: 'Add Sale' },
  { value: 'pos_sale', label: 'POS Sale' },
  { value: 'stock_transfers', label: 'Stock Transfers' },
  { value: 'stock_adjustment', label: 'Stock Adjustment' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'account', label: 'Account' },
  { value: 'tables', label: 'Tables (Restaurant)' },
  { value: 'modifiers', label: 'Modifiers (Restaurant)' },
  { value: 'service_staff', label: 'Service Staff (Restaurant)' },
  { value: 'booking', label: 'Booking' },
  { value: 'kitchen', label: 'Kitchen (Restaurant)' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'types_of_service', label: 'Types of Service' },
] as const;

/** Weighing-scale select ranges (defaults: sku=4, qty=3, qty_decimal=2). */
export const WEIGHING_SCALE_RANGES = {
  productSkuLength: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  qtyLength: [1, 2, 3, 4, 5],
  qtyLengthDecimal: [1, 2, 3, 4],
};

/** POS keyboard-shortcut action keys (settings_pos.blade `shortcuts[pos][...]`). */
export const POS_SHORTCUT_KEYS = [
  'express_checkout', 'pay_n_ckeckout', 'draft', 'duplicate', 'cancel',
  'recent_product_quantity', 'weighing_scale', 'edit_discount', 'edit_order_tax',
  'add_payment_row', 'finalize_payment', 'add_new_product',
] as const;

/** BusinessUtil::defaultPosSettings() / defaultEmailSettings() / defaultSmsSettings(). */
export const DEFAULT_POS_SETTINGS = {
  disable_pay_checkout: 0,
  disable_draft: 0,
  disable_duplicate: 0,
  disable_express_checkout: 0,
  hide_product_suggestion: 0,
  hide_recent_trans: 0,
  disable_discount: 0,
  disable_order_tax: 0,
  is_pos_subtotal_editable: 0,
};

export const DEFAULT_EMAIL_SETTINGS = {
  mail_host: '',
  mail_port: '',
  mail_username: '',
  mail_password: '',
  mail_encryption: '',
  mail_from_address: '',
  mail_from_name: '',
};

export const DEFAULT_SMS_SETTINGS = {
  url: '',
  send_to_param_name: 'to',
  msg_param_name: 'text',
  request_method: 'post',
  param_1: '', param_val_1: '',
  param_2: '', param_val_2: '',
  param_3: '', param_val_3: '',
  param_4: '', param_val_4: '',
  param_5: '', param_val_5: '',
};
