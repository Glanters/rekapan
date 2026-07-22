-- Per-bank member registrations behind the Monthly "Validasi" figure.
--
-- Validasi is a head count of members who registered on the day, broken down by
-- the bank they registered through. The breakdown is the stored truth; the
-- column total is derived from it, so the two cannot drift apart.

CREATE TYPE "ColumnComputation" AS ENUM ('NONE', 'VALIDATION_TOTAL');

ALTER TABLE "monthly_columns"
  ADD COLUMN "computation" "ColumnComputation" NOT NULL DEFAULT 'NONE';

CREATE TABLE "banks" (
  "id"          UUID         NOT NULL,
  "code"        VARCHAR(32)  NOT NULL,
  "name"        VARCHAR(128) NOT NULL,
  "position"    INTEGER      NOT NULL DEFAULT 0,
  "logoUrl"     TEXT,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,
  CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "banks_code_key" ON "banks"("code");
CREATE INDEX "banks_position_idx" ON "banks"("position");
CREATE INDEX "banks_deletedAt_idx" ON "banks"("deletedAt");

CREATE TABLE "monthly_validations" (
  "id"          UUID         NOT NULL,
  "reportId"    UUID         NOT NULL,
  "bankId"      UUID         NOT NULL,
  -- A head count, so an integer. Money elsewhere in this schema is Decimal.
  "memberCount" INTEGER      NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monthly_validations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "monthly_validations_reportId_bankId_key"
  ON "monthly_validations"("reportId", "bankId");
-- Bank-first, for "registrations per bank across a date range".
CREATE INDEX "monthly_validations_bankId_reportId_idx"
  ON "monthly_validations"("bankId", "reportId");

ALTER TABLE "monthly_validations"
  ADD CONSTRAINT "monthly_validations_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "monthly_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, not Cascade: deleting a bank that has recorded registrations would
-- silently erase history. The bank must be deactivated instead.
ALTER TABLE "monthly_validations"
  ADD CONSTRAINT "monthly_validations_bankId_fkey"
  FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Validasi becomes the derived total, and a head count rather than currency.
UPDATE "monthly_columns"
   SET "computation" = 'VALIDATION_TOTAL',
       "dataType"    = 'INTEGER',
       "precision"   = 0,
       "resultEffect"= 'NEUTRAL'
 WHERE "key" = 'validasi';
