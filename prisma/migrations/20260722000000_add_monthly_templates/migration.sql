-- Monthly report templates: per-brand column layouts. Additive and safe on a
-- populated database — existing columns and sites keep a null templateId, which
-- means "shared / no template", so behaviour is unchanged until the seed assigns
-- templates.

-- CreateTable
CREATE TABLE "monthly_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_templates_code_key" ON "monthly_templates"("code");

-- AlterTable
ALTER TABLE "monthly_columns" ADD COLUMN "templateId" UUID;

-- CreateIndex
CREATE INDEX "monthly_columns_templateId_idx" ON "monthly_columns"("templateId");

-- AddForeignKey
ALTER TABLE "monthly_columns" ADD CONSTRAINT "monthly_columns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "monthly_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "sites" ADD COLUMN "templateId" UUID;

-- CreateIndex
CREATE INDEX "sites_templateId_idx" ON "sites"("templateId");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "monthly_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
