-- The business owner's wildcard role is renamed "Admin" -> "Super Admin" so that a normal,
-- permission-scoped "Admin" role can exist below it. Existing tenants must be migrated or their
-- owner would stop resolving as isBusinessAdmin (which is derived from this role name).
-- Guarded so it is a no-op where a "Super Admin" role already exists for that business.
UPDATE "roles" r
SET "name" = 'Super Admin'
WHERE r."name" = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM "roles" x
    WHERE x."business_id" = r."business_id" AND x."name" = 'Super Admin'
  );
