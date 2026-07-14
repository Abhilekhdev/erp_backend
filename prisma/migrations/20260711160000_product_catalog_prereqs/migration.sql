-- CreateTable
CREATE TABLE "variation_templates" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "variation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variation_value_templates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "variation_template_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "variation_value_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranties" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "duration" INTEGER NOT NULL,
    "duration_type" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selling_price_groups" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "selling_price_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variation_templates_business_id_idx" ON "variation_templates"("business_id");

-- CreateIndex
CREATE INDEX "variation_value_templates_variation_template_id_idx" ON "variation_value_templates"("variation_template_id");

-- CreateIndex
CREATE INDEX "warranties_business_id_idx" ON "warranties"("business_id");

-- CreateIndex
CREATE INDEX "selling_price_groups_business_id_idx" ON "selling_price_groups"("business_id");

-- AddForeignKey
ALTER TABLE "variation_templates" ADD CONSTRAINT "variation_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_value_templates" ADD CONSTRAINT "variation_value_templates_variation_template_id_fkey" FOREIGN KEY ("variation_template_id") REFERENCES "variation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selling_price_groups" ADD CONSTRAINT "selling_price_groups_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

