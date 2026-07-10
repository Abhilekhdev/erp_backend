-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "short_code" VARCHAR(255),
    "description" TEXT,
    "created_by" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "short_code" VARCHAR(255),
    "description" TEXT,
    "created_by" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_business_id_idx" ON "departments"("business_id");

-- CreateIndex
CREATE INDEX "designations_business_id_idx" ON "designations"("business_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
