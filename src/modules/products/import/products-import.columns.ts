/**
 * The Import Products column spec — the single source of truth for the downloadable template, the
 * parser, and the on-screen instructions, exactly as `contacts-import.columns.ts` is for contacts.
 *
 * GOURI's shipped CSV is a stale 35-column file that disagrees with its own controller; the
 * authoritative layout is its 37-column instructions table, which is what we reproduce here.
 */
export interface ProductImportColumn {
  index: number; // 1-based, matches the on-screen "Col No."
  header: string;
  key: string;
  requirement: 'required' | 'optional';
  help: string;
}

export const PRODUCT_IMPORT_COLUMNS: ProductImportColumn[] = [
  { index: 1, header: 'NAME', key: 'name', requirement: 'required', help: 'Product name' },
  { index: 2, header: 'BRAND', key: 'brand', requirement: 'optional', help: 'Matched by name; created if it does not exist' },
  { index: 3, header: 'UNIT', key: 'unit', requirement: 'required', help: 'Matched by short name or full name; must already exist' },
  { index: 4, header: 'CATEGORY', key: 'category', requirement: 'optional', help: 'Matched by name; created if it does not exist' },
  { index: 5, header: 'SUB CATEGORY', key: 'sub_category', requirement: 'optional', help: 'Created under CATEGORY; requires CATEGORY to be filled' },
  { index: 6, header: 'SKU', key: 'sku', requirement: 'optional', help: 'Leave blank to auto-generate; must be unique if given' },
  { index: 7, header: 'BARCODE TYPE', key: 'barcode_type', requirement: 'optional', help: 'C128 (default), C39, EAN13, EAN8, UPCA, UPCE' },
  { index: 8, header: 'MANAGE STOCK', key: 'manage_stock', requirement: 'required', help: '1 = track stock, 0 = do not' },
  { index: 9, header: 'ALERT QUANTITY', key: 'alert_quantity', requirement: 'optional', help: 'Low-stock alert level (only if MANAGE STOCK = 1)' },
  { index: 10, header: 'EXPIRES IN', key: 'expires_in', requirement: 'optional', help: 'Expiry period number' },
  { index: 11, header: 'EXPIRY PERIOD UNIT', key: 'expiry_period_unit', requirement: 'optional', help: 'days or months' },
  { index: 12, header: 'APPLICABLE TAX', key: 'tax', requirement: 'optional', help: 'Matched by tax name; must already exist' },
  { index: 13, header: 'SELLING PRICE TAX TYPE', key: 'tax_type', requirement: 'required', help: 'inclusive or exclusive' },
  { index: 14, header: 'PRODUCT TYPE', key: 'product_type', requirement: 'required', help: 'single or variable (combo is skipped)' },
  { index: 15, header: 'VARIATION NAME', key: 'variation_name', requirement: 'optional', help: 'Required for a variable product, e.g. Colour' },
  { index: 16, header: 'VARIATION VALUES', key: 'variation_values', requirement: 'optional', help: 'Pipe-separated for a variable product, e.g. Red|Blue' },
  { index: 17, header: 'VARIATION SKU', key: 'variation_sku', requirement: 'optional', help: 'Pipe-separated, aligned to VARIATION VALUES; blank to auto-generate' },
  { index: 18, header: 'PURCHASE PRICE (INC TAX)', key: 'purchase_price_inc', requirement: 'optional', help: 'Pipe-separated for variable; one of INC/EXC is required' },
  { index: 19, header: 'PURCHASE PRICE (EXC TAX)', key: 'purchase_price_exc', requirement: 'optional', help: 'Pipe-separated for variable; one of INC/EXC is required' },
  { index: 20, header: 'PROFIT MARGIN %', key: 'profit_margin', requirement: 'optional', help: 'Used to compute the selling price when it is blank' },
  { index: 21, header: 'SELLING PRICE', key: 'selling_price', requirement: 'optional', help: 'Blank = purchase price plus margin' },
  { index: 22, header: 'OPENING STOCK', key: 'opening_stock', requirement: 'optional', help: 'Pipe-separated for variable; only if MANAGE STOCK = 1' },
  { index: 23, header: 'OPENING STOCK LOCATION', key: 'opening_stock_location', requirement: 'optional', help: 'Location name; blank = first location' },
  { index: 24, header: 'EXPIRY DATE', key: 'expiry_date', requirement: 'optional', help: 'YYYY-MM-DD, for the opening-stock lot' },
  { index: 25, header: 'ENABLE IMEI OR SERIAL NUMBER', key: 'enable_sr_no', requirement: 'optional', help: '1 or 0 (default 0)' },
  { index: 26, header: 'WEIGHT', key: 'weight', requirement: 'optional', help: 'Product weight' },
  { index: 27, header: 'RACK', key: 'rack', requirement: 'optional', help: 'Pipe-separated, one per location' },
  { index: 28, header: 'ROW', key: 'row', requirement: 'optional', help: 'Pipe-separated, one per location' },
  { index: 29, header: 'POSITION', key: 'position', requirement: 'optional', help: 'Pipe-separated, one per location' },
  { index: 30, header: 'IMAGE', key: 'image', requirement: 'optional', help: 'Image file name (URLs are stored, never fetched)' },
  { index: 31, header: 'PRODUCT DESCRIPTION', key: 'product_description', requirement: 'optional', help: 'Long description' },
  { index: 32, header: 'CUSTOM FIELD 1', key: 'custom_field1', requirement: 'optional', help: '' },
  { index: 33, header: 'CUSTOM FIELD 2', key: 'custom_field2', requirement: 'optional', help: '' },
  { index: 34, header: 'CUSTOM FIELD 3', key: 'custom_field3', requirement: 'optional', help: '' },
  { index: 35, header: 'CUSTOM FIELD 4', key: 'custom_field4', requirement: 'optional', help: '' },
  { index: 36, header: 'NOT FOR SELLING', key: 'not_for_selling', requirement: 'optional', help: '1 = not for selling, 0 = sellable (default)' },
  { index: 37, header: 'PRODUCT LOCATIONS', key: 'product_locations', requirement: 'optional', help: 'Comma-separated location names the product is sold at' },
];

export const OPENING_STOCK_IMPORT_COLUMNS: ProductImportColumn[] = [
  { index: 1, header: 'PRODUCT SKU', key: 'sku', requirement: 'required', help: "Matched by the variation's SKU; the product must track stock" },
  { index: 2, header: 'LOCATION NAME', key: 'location', requirement: 'optional', help: 'Location name; blank = first location' },
  { index: 3, header: 'QUANTITY', key: 'quantity', requirement: 'required', help: 'Opening quantity' },
  { index: 4, header: 'UNIT COST (BEFORE TAX)', key: 'unit_cost', requirement: 'required', help: 'Cost per unit, excluding tax' },
  { index: 5, header: 'LOT NUMBER', key: 'lot_number', requirement: 'optional', help: 'Batch / lot reference' },
  { index: 6, header: 'EXPIRY DATE', key: 'expiry_date', requirement: 'optional', help: 'YYYY-MM-DD' },
];
