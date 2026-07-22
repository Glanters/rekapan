-- Gallery images now declare which report family they support.
--
-- The column is NOT NULL with no default: every image must be attributable, and
-- a default would silently file unlabelled uploads under whichever value was
-- picked. Safe here because image_assets is empty; against a populated table
-- this would need a backfill first.
CREATE TYPE "ImageCategory" AS ENUM ('MONTHLY', 'TURNOVER');

ALTER TABLE "image_assets" ADD COLUMN "category" "ImageCategory" NOT NULL;

CREATE INDEX "image_assets_siteId_category_uploadDate_idx"
  ON "image_assets" ("siteId", "category", "uploadDate" DESC);

-- IF EXISTS: the preceding migration no longer creates these, so a database
-- built from scratch never has them. See that migration's section 3 for why
-- they were withdrawn rather than defended.
DROP INDEX IF EXISTS "monthly_values_column_report_covering_idx";
DROP INDEX IF EXISTS "turnover_values_game_report_covering_idx";
