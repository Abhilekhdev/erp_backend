-- CreateTable
CREATE TABLE "holidays" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "location_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_codes" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "activity_name" VARCHAR(255) NOT NULL,
    "activity_code" VARCHAR(255),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "activity_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_business_id_idx" ON "holidays"("business_id");

-- CreateIndex
CREATE INDEX "activity_codes_business_id_idx" ON "activity_codes"("business_id");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "business_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_codes" ADD CONSTRAINT "activity_codes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
