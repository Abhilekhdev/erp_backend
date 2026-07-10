-- CreateEnum
CREATE TYPE "SchemeType" AS ENUM ('blank', 'year');

-- CreateTable
CREATE TABLE "invoice_schemes" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "scheme_type" "SchemeType" NOT NULL DEFAULT 'blank',
    "prefix" VARCHAR(255),
    "start_number" INTEGER,
    "invoice_count" INTEGER NOT NULL DEFAULT 0,
    "total_digits" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "invoice_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_schemes_business_id_idx" ON "invoice_schemes"("business_id");

-- AddForeignKey
ALTER TABLE "invoice_schemes" ADD CONSTRAINT "invoice_schemes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
