-- Each Monthly column declares how it feeds the derived result ("Hasil").
--
-- NEUTRAL is the default so existing columns keep behaving exactly as before:
-- turning this on must not silently change a figure anyone is already reading.
CREATE TYPE "ResultEffect" AS ENUM ('NEUTRAL', 'ADD', 'SUBTRACT', 'RESULT');

ALTER TABLE "monthly_columns"
  ADD COLUMN "resultEffect" "ResultEffect" NOT NULL DEFAULT 'NEUTRAL';

-- At most one column may be the result. A partial unique index enforces it in
-- the database rather than trusting every future write path to remember —
-- two result columns would make "the" result ambiguous with no way to resolve it.
CREATE UNIQUE INDEX "monthly_columns_single_result_idx"
  ON "monthly_columns" (("resultEffect"))
  WHERE "resultEffect" = 'RESULT' AND "deletedAt" IS NULL;
