-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('user', 'user_customer');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'terminated');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('married', 'unmarried', 'divorced');

-- CreateEnum
CREATE TYPE "AccountingMethod" AS ENUM ('fifo', 'lifo', 'avco');

-- CreateEnum
CREATE TYPE "SellPriceTax" AS ENUM ('includes', 'excludes');

-- CreateEnum
CREATE TYPE "CurrencySymbolPlacement" AS ENUM ('before', 'after');

-- CreateEnum
CREATE TYPE "TimeFormat" AS ENUM ('12', '24');

-- CreateEnum
CREATE TYPE "SalesCommissionAgentSetting" AS ENUM ('logged_in_user', 'user', 'cmsn_agnt');

-- CreateEnum
CREATE TYPE "ReceiptPrinterType" AS ENUM ('browser', 'printer');

-- CreateEnum
CREATE TYPE "ExpiryType" AS ENUM ('add_expiry', 'add_manufacturing');

-- CreateEnum
CREATE TYPE "OnProductExpiry" AS ENUM ('keep_selling', 'stop_selling', 'auto_delete');

-- CreateEnum
CREATE TYPE "RewardPointExpiryType" AS ENUM ('month', 'year');

-- CreateTable
CREATE TABLE "currencies" (
    "id" SERIAL NOT NULL,
    "country" VARCHAR(100) NOT NULL,
    "currency" VARCHAR(100) NOT NULL,
    "code" VARCHAR(25) NOT NULL,
    "symbol" VARCHAR(25) NOT NULL,
    "thousand_separator" VARCHAR(10) NOT NULL,
    "decimal_separator" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "start_date" DATE,
    "tax_number_1" VARCHAR(100),
    "tax_label_1" VARCHAR(10),
    "tax_number_2" VARCHAR(100),
    "tax_label_2" VARCHAR(10),
    "code_label_1" VARCHAR(255),
    "code_1" VARCHAR(255),
    "code_label_2" VARCHAR(255),
    "code_2" VARCHAR(255),
    "default_sales_tax" INTEGER,
    "default_profit_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "owner_id" INTEGER NOT NULL,
    "time_zone" VARCHAR(255) NOT NULL DEFAULT 'Asia/Kolkata',
    "fy_start_month" SMALLINT NOT NULL DEFAULT 1,
    "accounting_method" "AccountingMethod" NOT NULL DEFAULT 'fifo',
    "default_sales_discount" DECIMAL(5,2),
    "sell_price_tax" "SellPriceTax" NOT NULL DEFAULT 'includes',
    "currency_precision" SMALLINT NOT NULL DEFAULT 2,
    "quantity_precision" SMALLINT NOT NULL DEFAULT 2,
    "currency_symbol_placement" "CurrencySymbolPlacement" NOT NULL DEFAULT 'before',
    "purchase_in_diff_currency" BOOLEAN NOT NULL DEFAULT false,
    "purchase_currency_id" INTEGER,
    "p_exchange_rate" DECIMAL(20,3) NOT NULL DEFAULT 1,
    "logo" VARCHAR(255),
    "login_logo" VARCHAR(255),
    "sku_prefix" VARCHAR(255),
    "theme_color" CHAR(20),
    "enable_brand" BOOLEAN NOT NULL DEFAULT true,
    "enable_category" BOOLEAN NOT NULL DEFAULT true,
    "enable_sub_category" BOOLEAN NOT NULL DEFAULT true,
    "enable_price_tax" BOOLEAN NOT NULL DEFAULT true,
    "enable_purchase_status" BOOLEAN DEFAULT true,
    "enable_lot_number" BOOLEAN NOT NULL DEFAULT false,
    "enable_sub_units" BOOLEAN NOT NULL DEFAULT false,
    "enable_racks" BOOLEAN NOT NULL DEFAULT false,
    "enable_row" BOOLEAN NOT NULL DEFAULT false,
    "enable_position" BOOLEAN NOT NULL DEFAULT false,
    "enable_editing_product_from_purchase" BOOLEAN NOT NULL DEFAULT true,
    "enable_tooltip" BOOLEAN NOT NULL DEFAULT true,
    "default_unit" INTEGER,
    "description_default" INTEGER NOT NULL DEFAULT 1,
    "enable_product_expiry" BOOLEAN NOT NULL DEFAULT false,
    "expiry_type" "ExpiryType" NOT NULL DEFAULT 'add_expiry',
    "on_product_expiry" "OnProductExpiry" NOT NULL DEFAULT 'keep_selling',
    "stop_selling_before" INTEGER,
    "stock_expiry_alert_days" INTEGER NOT NULL DEFAULT 30,
    "transaction_edit_days" INTEGER NOT NULL DEFAULT 30,
    "sales_cmsn_agnt" "SalesCommissionAgentSetting",
    "item_addition_method" BOOLEAN NOT NULL DEFAULT true,
    "enable_inline_tax" BOOLEAN NOT NULL DEFAULT true,
    "date_format" VARCHAR(255) NOT NULL DEFAULT 'm/d/Y',
    "time_format" "TimeFormat" NOT NULL DEFAULT '24',
    "keyboard_shortcuts" JSONB,
    "pos_settings" JSONB,
    "manufacturing_settings" JSONB,
    "essentials_settings" JSONB,
    "weighing_scale_setting" JSONB,
    "enabled_modules" JSONB,
    "ref_no_prefixes" JSONB,
    "email_settings" JSONB,
    "sms_settings" JSONB,
    "custom_labels" JSONB,
    "common_settings" JSONB,
    "enable_rp" BOOLEAN NOT NULL DEFAULT false,
    "rp_name" VARCHAR(255),
    "amount_for_unit_rp" DECIMAL(22,4) NOT NULL DEFAULT 1,
    "min_order_total_for_rp" DECIMAL(22,4) NOT NULL DEFAULT 1,
    "max_rp_per_order" INTEGER,
    "redeem_amount_per_unit_rp" DECIMAL(22,4) NOT NULL DEFAULT 1,
    "min_order_total_for_redeem" DECIMAL(22,4) NOT NULL DEFAULT 1,
    "min_redeem_point" INTEGER,
    "max_redeem_point" INTEGER,
    "rp_expiry_period" INTEGER,
    "rp_expiry_type" "RewardPointExpiryType" NOT NULL DEFAULT 'year',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "account_no" VARCHAR(100),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_locations" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "location_id" VARCHAR(255),
    "name" VARCHAR(256) NOT NULL,
    "landmark" TEXT,
    "country" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "zip_code" CHAR(7) NOT NULL,
    "invoice_scheme_id" INTEGER NOT NULL,
    "sale_invoice_scheme_id" INTEGER,
    "invoice_layout_id" INTEGER NOT NULL,
    "sale_invoice_layout_id" INTEGER,
    "selling_price_group_id" INTEGER,
    "print_receipt_on_invoice" BOOLEAN DEFAULT true,
    "receipt_printer_type" "ReceiptPrinterType" NOT NULL DEFAULT 'browser',
    "printer_id" INTEGER,
    "mobile" VARCHAR(255),
    "alternate_number" VARCHAR(255),
    "email" VARCHAR(255),
    "website" VARCHAR(255),
    "default_payment_accounts" JSONB,
    "featured_products" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "custom_field1" VARCHAR(255),
    "custom_field2" VARCHAR(255),
    "custom_field3" VARCHAR(255),
    "custom_field4" VARCHAR(255),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "business_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "user_type" "UserType" NOT NULL DEFAULT 'user',
    "surname" CHAR(10),
    "first_name" VARCHAR(255) NOT NULL,
    "last_name" VARCHAR(255),
    "username" VARCHAR(191),
    "email" VARCHAR(255) NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password_hash" VARCHAR(255) NOT NULL,
    "language" CHAR(7) NOT NULL DEFAULT 'en',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "allow_login" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMP(3),
    "business_id" INTEGER,
    "contact_no" CHAR(15),
    "address" TEXT,
    "is_cmmsn_agnt" BOOLEAN NOT NULL DEFAULT false,
    "cmmsn_percent" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "max_sales_discount_percent" DECIMAL(5,2),
    "selected_contacts" BOOLEAN NOT NULL DEFAULT false,
    "crm_contact_id" INTEGER,
    "available_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "essentials_department_id" INTEGER,
    "essentials_designation_id" INTEGER,
    "essentials_salary" DECIMAL(22,4),
    "essentials_pay_period" VARCHAR(255),
    "essentials_pay_cycle" VARCHAR(255),
    "location_id" INTEGER,
    "dob" DATE,
    "gender" VARCHAR(255),
    "marital_status" "MaritalStatus",
    "blood_group" CHAR(10),
    "contact_number" CHAR(20),
    "alt_number" VARCHAR(255),
    "family_number" VARCHAR(255),
    "fb_link" VARCHAR(255),
    "twitter_link" VARCHAR(255),
    "social_media_1" VARCHAR(255),
    "social_media_2" VARCHAR(255),
    "permanent_address" TEXT,
    "current_address" TEXT,
    "guardian_name" VARCHAR(255),
    "custom_field_1" VARCHAR(255),
    "custom_field_2" VARCHAR(255),
    "custom_field_3" VARCHAR(255),
    "custom_field_4" VARCHAR(255),
    "bank_details" TEXT,
    "id_proof_name" VARCHAR(255),
    "id_proof_number" VARCHAR(255),
    "password_change_at" TIMESTAMP(3),
    "parent_id" INTEGER,
    "activity_codes" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "business_id" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_service_staff" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "resource" VARCHAR(100),
    "action" VARCHAR(100),
    "category" VARCHAR(100),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_has_permissions" (
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "role_has_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "model_has_roles" (
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,

    CONSTRAINT "model_has_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "model_has_permissions" (
    "user_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "model_has_permissions_pkey" PRIMARY KEY ("user_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_locations" (
    "user_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("user_id","location_id")
);

-- CreateTable
CREATE TABLE "user_contact_access" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,

    CONSTRAINT "user_contact_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_documents" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "business_id" INTEGER,
    "location_id" INTEGER,
    "doc_name" VARCHAR(255),
    "document" VARCHAR(255),
    "doc_note" VARCHAR(255),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "user_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "family_id" TEXT NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_token_id" TEXT,
    "user_agent" TEXT,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "business_id" INTEGER,
    "user_id" INTEGER,
    "action" VARCHAR(100) NOT NULL,
    "subject_type" VARCHAR(191),
    "subject_id" INTEGER,
    "description" TEXT,
    "properties" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_currency_id_idx" ON "business"("currency_id");

-- CreateIndex
CREATE INDEX "business_owner_id_idx" ON "business"("owner_id");

-- CreateIndex
CREATE INDEX "business_is_active_idx" ON "business"("is_active");

-- CreateIndex
CREATE INDEX "business_locations_business_id_idx" ON "business_locations"("business_id");

-- CreateIndex
CREATE INDEX "business_locations_selling_price_group_id_idx" ON "business_locations"("selling_price_group_id");

-- CreateIndex
CREATE INDEX "business_locations_sale_invoice_layout_id_idx" ON "business_locations"("sale_invoice_layout_id");

-- CreateIndex
CREATE INDEX "business_locations_receipt_printer_type_idx" ON "business_locations"("receipt_printer_type");

-- CreateIndex
CREATE INDEX "business_locations_printer_id_idx" ON "business_locations"("printer_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_business_id_idx" ON "users"("business_id");

-- CreateIndex
CREATE INDEX "users_user_type_idx" ON "users"("user_type");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_essentials_department_id_idx" ON "users"("essentials_department_id");

-- CreateIndex
CREATE INDEX "users_essentials_designation_id_idx" ON "users"("essentials_designation_id");

-- CreateIndex
CREATE INDEX "users_location_id_idx" ON "users"("location_id");

-- CreateIndex
CREATE INDEX "users_parent_id_idx" ON "users"("parent_id");

-- CreateIndex
CREATE INDEX "roles_business_id_idx" ON "roles"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_business_id_name_key" ON "roles"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE INDEX "role_has_permissions_permission_id_idx" ON "role_has_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "model_has_roles_role_id_idx" ON "model_has_roles"("role_id");

-- CreateIndex
CREATE INDEX "model_has_permissions_permission_id_idx" ON "model_has_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_locations_location_id_idx" ON "user_locations"("location_id");

-- CreateIndex
CREATE INDEX "user_contact_access_user_id_idx" ON "user_contact_access"("user_id");

-- CreateIndex
CREATE INDEX "user_contact_access_contact_id_idx" ON "user_contact_access"("contact_id");

-- CreateIndex
CREATE INDEX "user_documents_user_id_idx" ON "user_documents"("user_id");

-- CreateIndex
CREATE INDEX "user_documents_business_id_idx" ON "user_documents"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "password_resets_email_idx" ON "password_resets"("email");

-- CreateIndex
CREATE INDEX "audit_logs_business_id_idx" ON "audit_logs"("business_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_purchase_currency_id_fkey" FOREIGN KEY ("purchase_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_locations" ADD CONSTRAINT "business_locations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "business_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_has_permissions" ADD CONSTRAINT "role_has_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_has_permissions" ADD CONSTRAINT "role_has_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_has_roles" ADD CONSTRAINT "model_has_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_has_roles" ADD CONSTRAINT "model_has_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_has_permissions" ADD CONSTRAINT "model_has_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_has_permissions" ADD CONSTRAINT "model_has_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "business_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contact_access" ADD CONSTRAINT "user_contact_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
