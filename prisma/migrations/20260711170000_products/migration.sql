-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50),
    "unit_id" INTEGER,
    "secondary_unit_id" INTEGER,
    "sub_unit_ids" JSONB,
    "brand_id" INTEGER,
    "category_id" INTEGER,
    "sub_category_id" INTEGER,
    "tax" INTEGER,
    "tax_type" VARCHAR(50) NOT NULL DEFAULT 'exclusive',
    "enable_stock" BOOLEAN NOT NULL DEFAULT false,
    "alert_quantity" DECIMAL(22,4),
    "sku" VARCHAR(255) NOT NULL,
    "barcode_type" VARCHAR(50) NOT NULL DEFAULT 'C128',
    "expiry_period" DECIMAL(8,2),
    "expiry_period_type" VARCHAR(50),
    "enable_sr_no" BOOLEAN NOT NULL DEFAULT false,
    "weight" VARCHAR(255),
    "product_custom_field1" VARCHAR(255),
    "product_custom_field2" VARCHAR(255),
    "product_custom_field3" VARCHAR(255),
    "product_custom_field4" VARCHAR(255),
    "image" VARCHAR(255),
    "product_description" TEXT,
    "created_by" INTEGER NOT NULL,
    "warranty_id" INTEGER,
    "is_inactive" BOOLEAN NOT NULL DEFAULT false,
    "not_for_selling" BOOLEAN NOT NULL DEFAULT false,
    "preparation_time_in_minutes" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variations" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "variation_template_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "is_dummy" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "product_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variations" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL DEFAULT 'DUMMY',
    "product_id" INTEGER NOT NULL,
    "sub_sku" VARCHAR(255),
    "product_variation_id" INTEGER NOT NULL,
    "variation_value_id" INTEGER,
    "default_purchase_price" DECIMAL(22,4),
    "dpp_inc_tax" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "profit_percent" DECIMAL(22,4) NOT NULL DEFAULT 0,
    "default_sell_price" DECIMAL(22,4),
    "sell_price_inc_tax" DECIMAL(22,4),
    "combo_variations" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variation_group_prices" (
    "id" SERIAL NOT NULL,
    "variation_id" INTEGER NOT NULL,
    "price_group_id" INTEGER NOT NULL,
    "price_inc_tax" DECIMAL(22,4) NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "variation_group_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_business_id_idx" ON "products"("business_id");

-- CreateIndex
CREATE INDEX "products_type_idx" ON "products"("type");

-- CreateIndex
CREATE INDEX "product_variations_product_id_idx" ON "product_variations"("product_id");

-- CreateIndex
CREATE INDEX "variations_product_id_idx" ON "variations"("product_id");

-- CreateIndex
CREATE INDEX "variations_product_variation_id_idx" ON "variations"("product_variation_id");

-- CreateIndex
CREATE INDEX "variation_group_prices_variation_id_idx" ON "variation_group_prices"("variation_id");

-- CreateIndex
CREATE INDEX "variation_group_prices_price_group_id_idx" ON "variation_group_prices"("price_group_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_product_variation_id_fkey" FOREIGN KEY ("product_variation_id") REFERENCES "product_variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_group_prices" ADD CONSTRAINT "variation_group_prices_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

