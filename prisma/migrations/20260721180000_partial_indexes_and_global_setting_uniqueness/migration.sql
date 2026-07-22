-- Indexes that Prisma's schema language cannot express.
--
-- All statements here are ADDITIVE. None modify or drop an index Prisma
-- generated, because `migrate dev` compares the database against schema.prisma
-- and would revert any change to an index it believes it owns. Additive indexes
-- sit outside that comparison.
--
-- Re-runnable: every statement is IF NOT EXISTS, so applying this against a
-- database that already has them is a no-op rather than an error.

-- ---------------------------------------------------------------------------
-- 1. Global settings uniqueness
-- ---------------------------------------------------------------------------
-- `@@unique([key, siteId])` does NOT prevent two global settings sharing a key:
-- siteId is NULL for globals, and in Postgres NULL <> NULL, so the unique index
-- treats every global row as distinct. Two rows with key='timezone' and a NULL
-- siteId coexist happily, and whichever the query happens to return first wins.
--
-- A partial unique index over the global rows closes it. Postgres 15's
-- NULLS NOT DISTINCT would also work, but only by redefining the index Prisma
-- owns — which the next `migrate dev` would undo.
CREATE UNIQUE INDEX IF NOT EXISTS "settings_key_global_key"
  ON "settings" ("key")
  WHERE "siteId" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Soft-delete partial indexes
-- ---------------------------------------------------------------------------
-- Every read filters `deletedAt IS NULL`. Without a partial index the planner
-- walks deleted rows too and then discards them — work that grows with every
-- correction ever made, on tables sized for millions of rows.
--
-- These are narrower than their full-table equivalents, so they also stay
-- resident in cache longer.

CREATE INDEX IF NOT EXISTS "monthly_reports_active_site_date_idx"
  ON "monthly_reports" ("siteId", "reportDate" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "monthly_reports_active_date_idx"
  ON "monthly_reports" ("reportDate" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "turnover_reports_active_site_date_idx"
  ON "turnover_reports" ("siteId", "reportDate" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "turnover_reports_active_date_idx"
  ON "turnover_reports" ("reportDate" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "image_assets_active_site_date_idx"
  ON "image_assets" ("siteId", "uploadDate" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "image_assets_active_uploader_idx"
  ON "image_assets" ("uploaderId", "uploadDate" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "users_active_status_idx"
  ON "users" ("status")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "sites_active_idx"
  ON "sites" ("status")
  WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Covering indexes for dashboard rollups — REMOVED, deliberately
-- ---------------------------------------------------------------------------
-- This migration originally added INCLUDE-covering indexes on
-- (columnId, reportId) and (gameId, reportId) so dashboard sums could be
-- answered by index-only scans.
--
-- They were removed after the next `migrate dev` generated DROP statements for
-- both. The distinction is worth recording: the partial indexes above survive
-- because Prisma's diff does not model a WHERE clause and cannot see them, but
-- a covering index looks like an ordinary index on columns the schema already
-- declares — so Prisma treats it as drift and reverts it, every time.
--
-- Keeping them would mean editing the generated SQL of every future migration,
-- which is a trap for whoever runs the next one without reading it. The plain
-- @@index([columnId, reportId]) in schema.prisma still serves these queries; it
-- pays one heap fetch per row that the INCLUDE would have avoided.
--
-- The real answer for aggregation at these row counts is the materialised view
-- already planned in the schema header, which Prisma does not manage and will
-- therefore leave alone.

-- ---------------------------------------------------------------------------
-- 4. Session lookup
-- ---------------------------------------------------------------------------
-- Resolving a session runs on every authenticated request; only live sessions
-- can ever match.
CREATE INDEX IF NOT EXISTS "sessions_live_idx"
  ON "sessions" ("tokenHash")
  WHERE "revokedAt" IS NULL;
