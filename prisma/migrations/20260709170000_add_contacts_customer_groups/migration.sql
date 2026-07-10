-- CreateEnum
CREATE TYPE "PayTermType" AS ENUM ('days', 'months');

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "type" VARCHAR(191) NOT NULL,
    "supplier_business_name" VARCHAR(255),
    "name" VARCHAR(191),
    "contact_id" VARCHAR(255),
    "contact_status" VARCHAR(255) NOT NULL DEFAULT 'active',
    "prefix" VARCHAR(255),
    "first_name" VARCHAR(255),
    "middle_name" VARCHAR(255),
    "last_name" VARCHAR(255),
    "email" VARCHAR(255),
    "tax_number" VARCHAR(255),
    "customer_group_id" INTEGER,
    "pay_term_number" INTEGER,
    "pay_term_type" "PayTermType",
    "credit_limit" DECIMAL(22,4),
    "mobile" VARCHAR(255) NOT NULL,
    "landline" VARCHAR(255),
    "alternate_number" VARCHAR(255),
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" VARCHAR(255),
    "state" VARCHAR(255),
    "country" VARCHAR(255),
    "zip_code" VARCHAR(255),
    "dob" DATE,
    "custom_field1" VARCHAR(255),
    "custom_field2" VARCHAR(255),
    "custom_field3" VARCHAR(255),
    "custom_field4" VARCHAR(255),
    "custom_field5" VARCHAR(255),
    "custom_field6" VARCHAR(255),
    "custom_field7" VARCHAR(255),
    "custom_field8" VARCHAR(255),
    "custom_field9" VARCHAR(255),
    "custom_field10" VARCHAR(255),
    "shipping_address" TEXT,
    "position" VARCHAR(255),
    "shipping_custom_field_details" JSONB,
    "is_export" BOOLEAN NOT NULL DEFAULT false,
    "export_custom_field_1" VARCHAR(255),
    "export_custom_field_2" VARCHAR(255),
    "export_custom_field_3" VARCHAR(255),
    "export_custom_field_4" VARCHAR(255),
    "export_custom_field_5" VARCHAR(255),
    "export_custom_field_6" VARCHAR(255),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "balance" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_groups" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(5,2) NOT NULL,
    "price_calculation_type" VARCHAR(255) NOT NULL DEFAULT 'percentage',
    "selling_price_group_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "customer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_business_id_idx" ON "contacts"("business_id");

-- CreateIndex
CREATE INDEX "contacts_type_idx" ON "contacts"("type");

-- CreateIndex
CREATE INDEX "contacts_contact_status_idx" ON "contacts"("contact_status");

-- CreateIndex
CREATE INDEX "contacts_customer_group_id_idx" ON "contacts"("customer_group_id");

-- CreateIndex
CREATE INDEX "contacts_business_id_type_deleted_at_idx" ON "contacts"("business_id", "type", "deleted_at");

-- CreateIndex
CREATE INDEX "customer_groups_business_id_idx" ON "customer_groups"("business_id");

-- CreateIndex
CREATE INDEX "customer_groups_price_calculation_type_idx" ON "customer_groups"("price_calculation_type");

-- CreateIndex
CREATE INDEX "customer_groups_selling_price_group_id_idx" ON "customer_groups"("selling_price_group_id");

-- AddForeignKey
ALTER TABLE "user_contact_access" ADD CONSTRAINT "user_contact_access_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_group_id_fkey" FOREIGN KEY ("customer_group_id") REFERENCES "customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

