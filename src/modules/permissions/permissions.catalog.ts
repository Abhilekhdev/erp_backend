/**
 * PERMISSION CATALOGUE — verified 1:1 against GOURI_DEV.
 * Sources: resources/views/role/create.blade.php (core groups, checkbox vs radio,
 * module conditionals), role/partials/module_permissions.blade.php, and each module's
 * DataController@user_permissions (Essentials/HRM, Manufacturing, DocumentSign),
 * cross-checked with the live `permissions` table (SQL dump, 206 rows).
 *
 * Structure mirrors the Laravel role form:
 *  - `checkbox` items → `permissions[]`
 *  - `radio` groups   → `radio_option[<name>]` (mutually-exclusive, e.g. view-all vs view-own)
 *  - `module`         → group only applies when that business module is enabled
 *  - `default: true`  → checked by default on a new role (dashboard.data, access_default_selling_price)
 *
 * The tenant **Admin** role is NOT represented here — it is the Gate::before wildcard
 * (see [[data-model-conventions]]); it bypasses every check in code.
 */

export interface PermCheckbox {
  type: 'checkbox';
  value: string;
  label: string;
  default?: boolean;
}
export interface PermRadio {
  type: 'radio';
  name: string; // radio_option[<name>]
  options: { value: string; label: string }[];
}
export type PermItem = PermCheckbox | PermRadio;

export interface PermGroup {
  key: string;
  label: string;
  module?: string; // enabled_modules flag, e.g. 'purchases'
  setting?: string; // business setting flag, e.g. 'enable_purchase_requisition'
  items: PermItem[];
}

const cb = (value: string, label: string, def = false): PermCheckbox => ({
  type: 'checkbox',
  value,
  label,
  ...(def ? { default: true } : {}),
});

export const PERMISSION_CATALOG: PermGroup[] = [
  {
    key: 'others',
    label: 'Others',
    items: [cb('view_export_buttons', 'View export buttons')],
  },
  {
    key: 'user',
    label: 'Users',
    items: [
      cb('user.view', 'View users'),
      cb('user.create', 'Add users'),
      cb('user.update', 'Edit users'),
      cb('user.delete', 'Delete users'),
    ],
  },
  {
    key: 'document',
    label: 'Documents',
    items: [
      cb('document.view', 'View documents'),
      cb('document.create', 'Add documents'),
      cb('document.update', 'Edit documents'),
      cb('document.delete', 'Delete documents'),
    ],
  },
  {
    key: 'roles',
    label: 'Roles',
    items: [
      cb('roles.view', 'View roles'),
      cb('roles.create', 'Add roles'),
      cb('roles.update', 'Edit roles'),
      cb('roles.delete', 'Delete roles'),
    ],
  },
  {
    key: 'supplier',
    label: 'Suppliers',
    items: [
      {
        type: 'radio',
        name: 'supplier_view',
        options: [
          { value: 'supplier.view', label: 'View all suppliers' },
          { value: 'supplier.view_own', label: 'View own suppliers' },
        ],
      },
      cb('supplier.create', 'Add suppliers'),
      cb('supplier.update', 'Edit suppliers'),
      cb('supplier.delete', 'Delete suppliers'),
    ],
  },
  {
    key: 'customer',
    label: 'Customers',
    items: [
      {
        type: 'radio',
        name: 'customer_view',
        options: [
          { value: 'customer.view', label: 'View all customers' },
          { value: 'customer.view_own', label: 'View own customers' },
        ],
      },
      {
        type: 'radio',
        name: 'customer_view_by_sell',
        options: [
          { value: 'customer_with_no_sell_one_month', label: 'Customers with no sale in 1 month' },
          { value: 'customer_with_no_sell_three_month', label: 'Customers with no sale in 3 months' },
          { value: 'customer_with_no_sell_six_month', label: 'Customers with no sale in 6 months' },
          { value: 'customer_with_no_sell_one_year', label: 'Customers with no sale in 1 year' },
          { value: 'customer_irrespective_of_sell', label: 'All customers irrespective of sale' },
        ],
      },
      cb('customer.create', 'Add customers'),
      cb('customer.update', 'Edit customers'),
      cb('customer.delete', 'Delete customers'),
    ],
  },
  {
    key: 'product',
    label: 'Products',
    items: [
      cb('product.view', 'View products'),
      cb('product.create', 'Add products'),
      cb('product.update', 'Edit products'),
      cb('product.delete', 'Delete products'),
      cb('product.opening_stock', 'Add opening stock'),
      cb('view_purchase_price', 'View purchase price'),
    ],
  },
  {
    key: 'purchase',
    label: 'Purchases',
    module: 'purchases',
    items: [
      {
        type: 'radio',
        name: 'purchase_view',
        options: [
          { value: 'purchase.view', label: 'View all purchases & stock adjustments' },
          { value: 'view_own_purchase', label: 'View own purchases & stock adjustments' },
        ],
      },
      cb('purchase.create', 'Add purchases'),
      cb('purchase.update', 'Edit purchases'),
      cb('purchase.delete', 'Delete purchases'),
      cb('purchase.payments', 'Add purchase payment'),
      cb('edit_purchase_payment', 'Edit purchase payment'),
      cb('delete_purchase_payment', 'Delete purchase payment'),
      cb('purchase.update_status', 'Update purchase status'),
      cb('purchase.duplicate', 'Duplicate purchase'),
      cb('purchase.approve', 'Approve purchase'),
    ],
  },
  {
    key: 'purchase_requisition',
    label: 'Purchase Requisition',
    setting: 'enable_purchase_requisition',
    items: [
      {
        type: 'radio',
        name: 'purchase_requisition_view',
        options: [
          { value: 'purchase_requisition.view_all', label: 'View all purchase requisitions' },
          { value: 'purchase_requisition.view_own', label: 'View own purchase requisitions' },
        ],
      },
      cb('purchase_requisition.create', 'Create purchase requisition'),
      cb('purchase_requisition.delete', 'Delete purchase requisition'),
    ],
  },
  {
    key: 'purchase_order',
    label: 'Purchase Order',
    setting: 'enable_purchase_order',
    items: [
      {
        type: 'radio',
        name: 'purchase_order_view',
        options: [
          { value: 'purchase_order.view_all', label: 'View all purchase orders' },
          { value: 'purchase_order.view_own', label: 'View own purchase orders' },
        ],
      },
      cb('purchase_order.create', 'Create purchase order'),
      cb('purchase_order.update', 'Edit purchase order'),
      cb('purchase_order.delete', 'Delete purchase order'),
    ],
  },
  {
    key: 'pos_sale',
    label: 'POS',
    items: [
      cb('sell.view', 'View POS sells'),
      cb('sell.create', 'Add POS sells'),
      cb('sell.update', 'Edit sells'),
      cb('sell.delete', 'Delete sells'),
      cb('edit_product_price_from_pos_screen', 'Edit product price from POS screen'),
      cb('edit_product_discount_from_pos_screen', 'Edit product discount from POS screen'),
      cb('edit_pos_payment', 'Add/Edit POS payment'),
      cb('print_invoice', 'Print invoice'),
    ],
  },
  {
    key: 'sale',
    label: 'Sale',
    items: [
      {
        type: 'radio',
        name: 'sell_view',
        options: [
          { value: 'direct_sell.view', label: 'View all sales' },
          { value: 'view_own_sell_only', label: 'View own sales only' },
        ],
      },
      cb('view_paid_sells_only', 'View paid sells only'),
      cb('view_due_sells_only', 'View due sells only'),
      cb('view_partial_sells_only', 'View partially-paid sells only'),
      cb('view_overdue_sells_only', 'View overdue sells only'),
      cb('direct_sell.access', 'Add sale'),
      cb('direct_sell.update', 'Update sale'),
      cb('direct_sell.delete', 'Delete sale'),
      cb('direct_sell.duplicate', 'Duplicate sale'),
      cb('view_commission_agent_sell', 'View commission agent sell'),
      cb('sell.payments', 'Add sell payment'),
      cb('edit_sell_payment', 'Edit sell payment'),
      cb('delete_sell_payment', 'Delete sell payment'),
      cb('edit_product_price_from_sale_screen', 'Edit product price from sale screen'),
      cb('edit_product_discount_from_sale_screen', 'Edit product discount from sale screen'),
      cb('discount.access', 'Access discounts'),
      cb('access_types_of_service', 'Access types of service'),
      cb('access_sell_return', 'Access all sell returns'),
      cb('access_own_sell_return', 'Access own sell returns'),
      cb('edit_invoice_number', 'Add/Edit invoice number'),
    ],
  },
  {
    key: 'sales_order',
    label: 'Sales Order',
    setting: 'enable_sales_order',
    items: [
      {
        type: 'radio',
        name: 'so_view',
        options: [
          { value: 'so.view_all', label: 'View all sales orders' },
          { value: 'so.view_own', label: 'View own sales orders' },
        ],
      },
      cb('so.create', 'Create sales order'),
      cb('so.update', 'Edit sales order'),
      cb('so.delete', 'Delete sales order'),
    ],
  },
  {
    key: 'draft',
    label: 'Draft',
    items: [
      {
        type: 'radio',
        name: 'draft_view',
        options: [
          { value: 'draft.view_all', label: 'View all drafts' },
          { value: 'draft.view_own', label: 'View own drafts' },
        ],
      },
      cb('draft.update', 'Edit draft'),
      cb('draft.delete', 'Delete draft'),
    ],
  },
  {
    key: 'quotation',
    label: 'Quotation',
    items: [
      {
        type: 'radio',
        name: 'quotation_view',
        options: [
          { value: 'quotation.view_all', label: 'View all quotations' },
          { value: 'quotation.view_own', label: 'View own quotations' },
        ],
      },
      cb('quotation.update', 'Edit quotation'),
      cb('quotation.delete', 'Delete quotation'),
    ],
  },
  {
    key: 'shipments',
    label: 'Shipments',
    items: [
      {
        type: 'radio',
        name: 'shipping_view',
        options: [
          { value: 'access_shipping', label: 'Access all shipments' },
          { value: 'access_own_shipping', label: 'Access own shipping' },
        ],
      },
      cb('access_pending_shipments_only', 'Access pending shipments only'),
      cb('access_commission_agent_shipping', 'Access commission agent shipping'),
    ],
  },
  {
    key: 'cash_register',
    label: 'Cash Register',
    items: [cb('view_cash_register', 'View cash register'), cb('close_cash_register', 'Close cash register')],
  },
  {
    key: 'brand',
    label: 'Brands',
    items: [
      cb('brand.view', 'View brands'),
      cb('brand.create', 'Add brands'),
      cb('brand.update', 'Edit brands'),
      cb('brand.delete', 'Delete brands'),
    ],
  },
  {
    key: 'tax_rate',
    label: 'Tax Rates',
    items: [
      cb('tax_rate.view', 'View tax rates'),
      cb('tax_rate.create', 'Add tax rates'),
      cb('tax_rate.update', 'Edit tax rates'),
      cb('tax_rate.delete', 'Delete tax rates'),
    ],
  },
  {
    key: 'unit',
    label: 'Units',
    items: [
      cb('unit.view', 'View units'),
      cb('unit.create', 'Add units'),
      cb('unit.update', 'Edit units'),
      cb('unit.delete', 'Delete units'),
    ],
  },
  {
    key: 'category',
    label: 'Categories',
    items: [
      cb('category.view', 'View categories'),
      cb('category.create', 'Add categories'),
      cb('category.update', 'Edit categories'),
      cb('category.delete', 'Delete categories'),
    ],
  },
  {
    key: 'report',
    label: 'Reports',
    items: [
      cb('purchase_n_sell_report.view', 'Purchase & Sale report'),
      cb('tax_report.view', 'Tax report'),
      cb('contacts_report.view', 'Supplier & Customer report'),
      cb('expense_report.view', 'Expense report'),
      cb('profit_loss_report.view', 'Profit/Loss report'),
      cb('stock_report.view', 'Stock report'),
      cb('trending_product_report.view', 'Trending products report'),
      cb('register_report.view', 'Register report'),
      cb('sales_representative.view', 'Sales representative report'),
      cb('view_product_stock_value', 'View product stock value'),
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    items: [
      cb('business_settings.access', 'Access business settings'),
      cb('barcode_settings.access', 'Access barcode settings'),
      cb('invoice_settings.access', 'Access invoice settings'),
      cb('access_printers', 'Access printers'),
    ],
  },
  {
    // Gates the Notification Templates page — GOURI NotificationTemplateController@index/@store
    // both check `send_notification` (see also the standalone sidebar menu item, order 80).
    key: 'notification',
    label: 'Notifications',
    items: [cb('send_notification', 'Access notification templates')],
  },
  {
    key: 'expense',
    label: 'Expenses',
    module: 'expenses',
    items: [
      {
        type: 'radio',
        name: 'expense_view',
        options: [
          { value: 'all_expense.access', label: 'Access all expenses' },
          { value: 'view_own_expense', label: 'View own expenses' },
        ],
      },
      cb('expense.add', 'Add expense'),
      cb('expense.edit', 'Edit expense'),
      cb('expense.delete', 'Delete expense'),
    ],
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    items: [cb('dashboard.data', 'View dashboard data', true)],
  },
  {
    key: 'account',
    label: 'Payment Accounts',
    items: [
      cb('account.access', 'Access accounts'),
      cb('edit_account_transaction', 'Edit account transaction'),
      cb('delete_account_transaction', 'Delete account transaction'),
    ],
  },
  {
    key: 'bookings',
    label: 'Bookings',
    module: 'booking',
    items: [
      {
        type: 'radio',
        name: 'bookings_view',
        options: [
          { value: 'crud_all_bookings', label: 'Add/Edit/View all bookings' },
          { value: 'crud_own_bookings', label: 'Add/Edit/View own bookings' },
        ],
      },
    ],
  },
  {
    key: 'selling_price_group',
    label: 'Selling Price Groups',
    items: [cb('access_default_selling_price', 'Access default selling price', true)],
  },
  {
    key: 'restaurant',
    label: 'Restaurant',
    module: 'tables',
    items: [cb('access_tables', 'Access tables')],
  },
  {
    key: 'training',
    label: 'Training',
    items: [
      {
        type: 'radio',
        name: 'training_view',
        options: [
          { value: 'view_all_training', label: 'Access all training' },
          { value: 'view_own_training', label: 'Access own training' },
        ],
      },
      cb('training.view_training', 'View training'),
      cb('training.create_training', 'Create training'),
      cb('training.edit_training', 'Edit training'),
      cb('training.delete_training', 'Delete training'),
    ],
  },
  {
    key: 'hrm',
    label: 'HRM (Essentials)',
    module: 'essentials',
    items: [
      cb('essentials.crud_leave_type', 'Manage leave types'),
      {
        type: 'radio',
        name: 'leave_crud',
        options: [
          { value: 'essentials.crud_all_leave', label: 'Manage all leaves' },
          { value: 'essentials.crud_own_leave', label: 'Manage own leaves' },
        ],
      },
      cb('essentials.approve_leave', 'Approve leave'),
      {
        type: 'radio',
        name: 'view_all_attendance',
        options: [
          { value: 'essentials.view_all_attendance', label: 'View all attendance' },
          { value: 'essentials.view_own_attendance', label: 'View own attendance' },
        ],
      },
      cb('essentials.add_attendance', 'Add attendance'),
      cb('essentials.edit_attendance', 'Edit attendance'),
      cb('essentials.delete_attendance', 'Delete attendance'),
      cb('essentials.shift_transfer', 'Shift transfer'),
      cb('essentials.allow_users_for_attendance_from_web', 'Allow attendance from web'),
      cb('essentials.allow_users_for_attendance_from_api', 'Allow attendance from API'),
      cb('essentials.view_allowance_and_deduction', 'View pay components'),
      cb('essentials.add_allowance_and_deduction', 'Add pay components'),
      cb('essentials.approve_allowance_and_deduction', 'Approve pay components'),
      cb('essentials.view_claim_reimbursement', 'View claim & reimbursement'),
      cb('essentials.add_claim_reimbursement', 'Add claim & reimbursement'),
      cb('essentials.approve_claim_reimbursement', 'Approve claim & reimbursement'),
      cb('essentials.claim_reimbursement_category', 'View claim categories'),
      cb('essentials.add_claim_reimbursement_category', 'Add claim categories'),
      cb('essentials.crud_department', 'Manage departments'),
      cb('essentials.crud_designation', 'Manage designations'),
      cb('essentials.view_all_payroll', 'View all payroll'),
      cb('essentials.create_payroll', 'Add payroll'),
      cb('essentials.update_payroll', 'Edit payroll'),
      cb('essentials.delete_payroll', 'Delete payroll'),
      cb('essentials.create_message', 'Create message'),
      cb('essentials.view_message', 'View message'),
      cb('essentials.access_sales_target', 'Access sales target'),
      cb('essentials.add_holiday', 'Add holiday'),
      cb('essentials.edit_holiday', 'Edit holiday'),
      cb('essentials.delete_holiday', 'Delete holiday'),
    ],
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing',
    module: 'manufacturing',
    items: [
      cb('manufacturing.access_recipe', 'Access recipe'),
      cb('manufacturing.access_production', 'Access production'),
      cb('manufacturing.add_recipe', 'Add recipe'),
      cb('manufacturing.edit_recipe', 'Edit recipe'),
    ],
  },
  {
    key: 'documentsign',
    label: 'Document Sign',
    module: 'documentsign',
    items: [
      cb('documentsign.view_documents', 'View documents'),
      cb('documentsign.crud_documents', 'Manage documents'),
    ],
  },
];

/** Flat list of every static permission name in the catalogue (for seeding & validation). */
export function allPermissionValues(): string[] {
  const out: string[] = [];
  for (const group of PERMISSION_CATALOG) {
    for (const item of group.items) {
      if (item.type === 'checkbox') out.push(item.value);
      else item.options.forEach((o) => out.push(o.value));
    }
  }
  return Array.from(new Set(out));
}
