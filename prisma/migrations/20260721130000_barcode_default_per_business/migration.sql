-- "Default label sheet" is a per-business choice, so a SHARED preset (business_id IS NULL) must
-- never carry the flag — otherwise every tenant sees two defaults the moment it picks its own.
-- The fallback for a business that has not chosen is resolved in code (first preset by id).
UPDATE "barcodes" SET "is_default" = FALSE WHERE "business_id" IS NULL;
