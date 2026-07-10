/**
 * NOTIFICATION DEFINITIONS — verified 1:1 against GOURI_DEV `app/NotificationTemplate.php`
 * (customerNotifications / supplierNotifications / generalNotifications / bookingNotificationTags
 * / defaultNotificationTemplates) and the labels in `lang/en/lang_v1.php`.
 *
 * `extraTags` mirrors the Laravel nested arrays exactly, including the per-tenant currency
 * symbol prefixed onto amount tags (Laravel: `"$currency->symbol ".'{total_amount}'`) — so the
 * lists are built by functions that take the business currency `symbol`.
 *
 * Module-contributed notifications (`ModuleUtil::getModuleData('notification_list', …)`) are NOT
 * merged here — those modules aren't built yet (same stance as business-settings' taxRates/units).
 */

export interface NotificationDef {
  /** template_for — the stable key persisted in notification_templates.template_for */
  key: string;
  name: string;
  extraTags: string[][];
  helpText?: string;
  /** send_ledger hides SMS + WhatsApp fields (matches the `@if($key == 'send_ledger') hide` in tabs.blade.php) */
  hideSmsWhatsapp?: boolean;
}

// --- tag helpers (keep the exact repetitive lists faithful) ---
const businessTags = (): string[] => ['{business_name}', '{business_logo}'];
const contactCustomFields = (): string[] =>
  Array.from({ length: 10 }, (_, i) => `{contact_custom_field_${i + 1}}`);
const contactTags = (): string[] => ['{contact_name}', ...contactCustomFields()];
const locationTags = (): string[] => [
  '{location_name}',
  '{location_address}',
  '{location_email}',
  '{location_phone}',
  '{location_custom_field_1}',
  '{location_custom_field_2}',
  '{location_custom_field_3}',
  '{location_custom_field_4}',
];
const amt = (symbol: string, tag: string): string => `${symbol} ${tag}`;

/** GOURI NotificationTemplate::bookingNotificationTags() */
function bookingNotificationTags(): string[][] {
  return [
    businessTags(),
    ['{table}', '{start_time}', '{end_time}', '{service_staff}', '{correspondent}'],
    [
      '{location}',
      '{location_name}',
      '{location_address}',
      '{location_email}',
      '{location_phone}',
      '{location_custom_field_1}',
      '{location_custom_field_2}',
      '{location_custom_field_3}',
      '{location_custom_field_4}',
    ],
    contactTags(),
  ];
}

/** GOURI NotificationTemplate::generalNotifications() */
export function generalNotifications(): NotificationDef[] {
  return [
    {
      key: 'send_ledger',
      name: 'Send Ledger',
      hideSmsWhatsapp: true,
      extraTags: [businessTags(), ['{balance_due}'], contactTags()],
    },
  ];
}

/** GOURI NotificationTemplate::customerNotifications() */
export function customerNotifications(symbol: string): NotificationDef[] {
  return [
    {
      key: 'new_sale',
      name: 'New Sale',
      helpText:
        'If enabled, sell notification will be automatically sent to customer on creating new sales for them',
      extraTags: [
        businessTags(),
        [
          '{invoice_number}',
          '{invoice_url}',
          amt(symbol, '{total_amount}'),
          amt(symbol, '{paid_amount}'),
          amt(symbol, '{due_amount}'),
          amt(symbol, '{cumulative_due_amount}'),
          '{due_date}',
        ],
        locationTags(),
        contactTags(),
        ['{sell_custom_field_1}', '{sell_custom_field_2}', '{sell_custom_field_3}', '{sell_custom_field_4}'],
        [
          '{shipping_custom_field_1}',
          '{shipping_custom_field_2}',
          '{shipping_custom_field_3}',
          '{shipping_custom_field_4}',
          '{shipping_custom_field_5}',
        ],
      ],
    },
    {
      key: 'payment_received',
      name: 'Payment Received',
      extraTags: [
        businessTags(),
        ['{invoice_number}', '{payment_ref_number}', amt(symbol, '{received_amount}')],
        contactTags(),
      ],
    },
    {
      key: 'payment_reminder',
      name: 'Payment Remider',
      helpText:
        'If enabled, payment reminder notification will be automatically sent to customer on invoice overdue',
      extraTags: [
        businessTags(),
        ['{invoice_number}', amt(symbol, '{due_amount}'), amt(symbol, '{cumulative_due_amount}'), '{due_date}'],
        contactTags(),
      ],
    },
    {
      key: 'new_booking',
      name: 'New Booking',
      extraTags: bookingNotificationTags(),
    },
    {
      key: 'new_quotation',
      name: 'New Quotation',
      extraTags: [
        businessTags(),
        ['{invoice_number}', amt(symbol, '{total_amount}'), '{quote_url}'],
        locationTags(),
        contactTags(),
      ],
    },
    {
      key: 'new_customer',
      name: 'Welcome User',
      extraTags: [businessTags(), ['{name}'], ['{user_name}'], ['{password}'], ['{login_url}']],
    },
  ];
}

/** GOURI NotificationTemplate::supplierNotifications() */
export function supplierNotifications(symbol: string): NotificationDef[] {
  return [
    {
      key: 'new_order',
      name: 'New Order',
      extraTags: [
        businessTags(),
        [
          '{order_ref_number}',
          amt(symbol, '{total_amount}'),
          amt(symbol, '{received_amount}'),
          amt(symbol, '{due_amount}'),
        ],
        locationTags(),
        [
          '{purchase_custom_field_1}',
          '{purchase_custom_field_2}',
          '{purchase_custom_field_3}',
          '{purchase_custom_field_4}',
          '{contact_business_name}',
        ],
        contactTags(),
        [
          '{shipping_custom_field_1}',
          '{shipping_custom_field_2}',
          '{shipping_custom_field_3}',
          '{shipping_custom_field_4}',
          '{shipping_custom_field_5}',
        ],
      ],
    },
    {
      key: 'payment_paid',
      name: 'Payment Paid',
      extraTags: [
        businessTags(),
        ['{order_ref_number}', '{payment_ref_number}', amt(symbol, '{paid_amount}')],
        ['{contact_name}', '{contact_business_name}', ...contactCustomFields()],
      ],
    },
    {
      key: 'items_received',
      name: 'Items Received',
      extraTags: [
        businessTags(),
        ['{order_ref_number}'],
        ['{contact_business_name}', '{contact_name}', ...contactCustomFields()],
      ],
    },
    {
      key: 'items_pending',
      name: 'Items Pending',
      extraTags: [
        businessTags(),
        ['{order_ref_number}'],
        ['{contact_business_name}', '{contact_name}', ...contactCustomFields()],
      ],
    },
    {
      key: 'purchase_order',
      name: 'Purchase Order',
      extraTags: [
        businessTags(),
        ['{order_ref_number}'],
        ['{contact_business_name}', '{contact_name}', ...contactCustomFields()],
      ],
    },
  ];
}

/** All template_for keys this module recognises (used to validate the save payload). */
export function allTemplateKeys(): string[] {
  return [
    ...generalNotifications().map((n) => n.key),
    ...customerNotifications('').map((n) => n.key),
    ...supplierNotifications('').map((n) => n.key),
  ];
}

export interface DefaultTemplate {
  template_for: string;
  email_body: string;
  sms_body: string;
  subject: string;
  auto_send: string;
}

/**
 * GOURI NotificationTemplate::defaultNotificationTemplates() — the content a freshly-seeded
 * business starts with. Used as the display fallback when a tenant has no saved row for a key
 * (equivalent to the Laravel seeder migration `add_default_notification_templates_to_database`).
 */
export function defaultNotificationTemplates(symbol: string): DefaultTemplate[] {
  return [
    {
      template_for: 'new_sale',
      email_body: `<p>Dear {contact_name},</p>

                    <p>Your invoice number is {invoice_number}<br />
                    Total amount: ${symbol} {total_amount}<br />
                    Paid amount: ${symbol} {received_amount}</p>

                    <p>Thank you for shopping with us.</p>

                    <p>{business_logo}</p>

                    <p>&nbsp;</p>`,
      sms_body: 'Dear {contact_name}, Thank you for shopping with us. {business_name}',
      subject: 'Thank you from {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'payment_received',
      email_body: `<p>Dear {contact_name},</p>

                <p>We have received a payment of ${symbol} {received_amount}</p>

                <p>{business_logo}</p>`,
      sms_body: `Dear {contact_name}, We have received a payment of ${symbol} {received_amount}. {business_name}`,
      subject: 'Payment Received, from {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'payment_reminder',
      email_body: `<p>Dear {contact_name},</p>

                    <p>This is to remind you that you have pending payment of ${symbol} {due_amount}. Kindly pay it as soon as possible.</p>

                    <p>{business_logo}</p>`,
      sms_body: `Dear {contact_name}, You have pending payment of ${symbol} {due_amount}. Kindly pay it as soon as possible. {business_name}`,
      subject: 'Payment Reminder, from {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'new_booking',
      email_body: `<p>Dear {contact_name},</p>

                    <p>Your booking is confirmed</p>

                    <p>Date: {start_time} to {end_time}</p>

                    <p>Table: {table}</p>

                    <p>Location: {location}</p>

                    <p>{business_logo}</p>`,
      sms_body:
        'Dear {contact_name}, Your booking is confirmed. Date: {start_time} to {end_time}, Table: {table}, Location: {location}',
      subject: 'Booking Confirmed - {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'new_order',
      email_body: `<p>Dear {contact_name},</p>

                    <p>We have a new order with reference number {order_ref_number}. Kindly process the products as soon as possible.</p>

                    <p>{business_name}<br />
                    {business_logo}</p>`,
      sms_body:
        'Dear {contact_name}, We have a new order with reference number {order_ref_number}. Kindly process the products as soon as possible. {business_name}',
      subject: 'New Order, from {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'payment_paid',
      email_body: `<p>Dear {contact_name},</p>

                    <p>We have paid amount ${symbol} {paid_amount} again invoice number {order_ref_number}.<br />
                    Kindly note it down.</p>

                    <p>{business_name}<br />
                    {business_logo}</p>`,
      sms_body: `We have paid amount ${symbol} {paid_amount} again invoice number {order_ref_number}.
                    Kindly note it down. {business_name}`,
      subject: 'Payment Paid, from {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'items_received',
      email_body: `<p>Dear {contact_name},</p>

                    <p>We have received all items from invoice reference number {order_ref_number}. Thank you for processing it.</p>

                    <p>{business_name}<br />
                    {business_logo}</p>`,
      sms_body:
        'We have received all items from invoice reference number {order_ref_number}. Thank you for processing it. {business_name}',
      subject: 'Items received, from {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'items_pending',
      email_body: `<p>Dear {contact_name},<br />
                    This is to remind you that we have not yet received some items from invoice reference number {order_ref_number}. Please process it as soon as possible.</p>

                    <p>{business_name}<br />
                    {business_logo}</p>`,
      sms_body:
        'This is to remind you that we have not yet received some items from invoice reference number {order_ref_number} . Please process it as soon as possible.{business_name}',
      subject: 'Items Pending, from {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'new_quotation',
      email_body: `<p>Dear {contact_name},</p>

                    <p>Your quotation number is {invoice_number}<br />
                    Total amount: ${symbol} {total_amount}</p>

                    <p>Thank you for shopping with us.</p>

                    <p>{business_logo}</p>

                    <p>&nbsp;</p>`,
      sms_body: 'Dear {contact_name}, Thank you for shopping with us. {business_name}',
      subject: 'Thank you from {business_name}',
      auto_send: '0',
    },
    {
      template_for: 'purchase_order',
      email_body: `<p>Dear {contact_name},</p>

                    <p>We have a new purchase order with reference number {order_ref_number}. The respective invoice is attached here with.</p>

                    <p>{business_logo}</p>`,
      sms_body: 'We have a new purchase order with reference number {order_ref_number}. {business_name}',
      subject: 'New Purchase Order, from {business_name}',
      auto_send: '0',
    },
  ];
}
