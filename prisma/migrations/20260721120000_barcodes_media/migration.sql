-- CreateTable
CREATE TABLE "media" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "model_type" VARCHAR(191) NOT NULL,
    "model_id" INTEGER NOT NULL,
    "model_media_type" VARCHAR(191),
    "file_path" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(191),
    "file_size" INTEGER,
    "description" TEXT,
    "uploaded_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barcodes" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "width" DECIMAL(22,4),
    "height" DECIMAL(22,4),
    "paper_width" DECIMAL(22,4),
    "paper_height" DECIMAL(22,4),
    "top_margin" DECIMAL(22,4),
    "left_margin" DECIMAL(22,4),
    "row_distance" DECIMAL(22,4),
    "col_distance" DECIMAL(22,4),
    "stickers_in_one_row" INTEGER,
    "stickers_in_one_sheet" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_continuous" BOOLEAN NOT NULL DEFAULT false,
    "business_id" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_business_id_idx" ON "media"("business_id");

-- CreateIndex
CREATE INDEX "media_model_type_model_id_model_media_type_idx" ON "media"("model_type", "model_id", "model_media_type");

-- CreateIndex
CREATE INDEX "barcodes_business_id_idx" ON "barcodes"("business_id");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Built-in label-sheet presets (business_id NULL = available to every tenant).
-- Print Labels cannot render without a sheet, so ship the common Avery-style layouts up front —
-- GOURI seeds the same set. Measurements are inches, matching GOURI's `barcodes` floats.
INSERT INTO "barcodes"
  ("name", "description", "width", "height", "paper_width", "paper_height", "top_margin", "left_margin",
   "row_distance", "col_distance", "stickers_in_one_row", "stickers_in_one_sheet", "is_default",
   "is_continuous", "business_id", "created_at")
VALUES
  ('20 Labels per Sheet', '4 columns x 5 rows, 2" x 1" labels (Avery 5161)',
   2.0, 1.0, 8.5, 11.0, 0.5, 0.20, 0.0, 0.15, 4, 20, TRUE, FALSE, NULL, NOW()),
  ('30 Labels per Sheet', '3 columns x 10 rows, 2.625" x 1" labels (Avery 5160)',
   2.625, 1.0, 8.5, 11.0, 0.5, 0.19, 0.0, 0.14, 3, 30, FALSE, FALSE, NULL, NOW()),
  ('32 Labels per Sheet', '4 columns x 8 rows, 2" x 1.25" labels',
   2.0, 1.25, 8.5, 11.0, 0.5, 0.25, 0.0, 0.12, 4, 32, FALSE, FALSE, NULL, NOW()),
  ('40 Labels per Sheet', '4 columns x 10 rows, 2" x 1" labels',
   2.0, 1.0, 8.5, 11.0, 0.5, 0.20, 0.0, 0.12, 4, 40, FALSE, FALSE, NULL, NOW()),
  ('50 Labels per Sheet', '5 columns x 10 rows, 1.5" x 1" labels',
   1.5, 1.0, 8.5, 11.0, 0.5, 0.20, 0.0, 0.10, 5, 50, FALSE, FALSE, NULL, NOW()),
  ('Continuous Roll (1 per row)', 'Roll printer — one sticker per row, no sheet',
   2.25, 1.25, 2.25, NULL, 0.0, 0.0, 0.0, 0.0, 1, NULL, FALSE, TRUE, NULL, NOW()),
  ('Continuous Roll (2 per row)', 'Roll printer — two stickers per row, no sheet',
   2.0, 1.0, 4.0, NULL, 0.0, 0.0, 0.0, 0.10, 2, NULL, FALSE, TRUE, NULL, NOW());
