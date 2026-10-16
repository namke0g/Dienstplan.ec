-- The phone app was removed: drop its device tokens, then the platform values (only browser subscriptions remain).
BEGIN;
DELETE FROM "DeviceToken" WHERE "platform" <> 'WEB';
CREATE TYPE "Platform_new" AS ENUM ('WEB');
ALTER TABLE "DeviceToken" ALTER COLUMN "platform" TYPE "Platform_new" USING ("platform"::text::"Platform_new");
ALTER TYPE "Platform" RENAME TO "Platform_old";
ALTER TYPE "Platform_new" RENAME TO "Platform";
DROP TYPE "public"."Platform_old";
COMMIT;
