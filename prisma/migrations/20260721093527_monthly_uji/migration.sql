-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ColumnDataType" AS ENUM ('CURRENCY', 'DECIMAL', 'INTEGER', 'PERCENT', 'TEXT', 'DATE', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('MONTHLY', 'TURNOVER');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('XLSX', 'CSV', 'PDF');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "externalId" VARCHAR(191),
    "email" VARCHAR(191) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "avatarUrl" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "roleId" UUID,
    "activatedAt" TIMESTAMP(3),
    "activatedById" UUID,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" VARCHAR(45),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "level" INTEGER NOT NULL DEFAULT 100,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(96) NOT NULL,
    "module" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(191) NOT NULL,
    "logoUrl" TEXT,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    "currency" VARCHAR(8) NOT NULL DEFAULT 'IDR',
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sites" (
    "userId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" UUID,

    CONSTRAINT "user_sites_pkey" PRIMARY KEY ("userId","siteId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "accountCenterToken" TEXT,
    "accountCenterTokenExpires" TIMESTAMP(3),
    "ip" VARCHAR(45),
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_columns" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(128) NOT NULL,
    "dataType" "ColumnDataType" NOT NULL DEFAULT 'CURRENCY',
    "group" VARCHAR(64),
    "position" INTEGER NOT NULL DEFAULT 0,
    "precision" INTEGER NOT NULL DEFAULT 2,
    "unit" VARCHAR(16),
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "includeInTotals" BOOLEAN NOT NULL DEFAULT true,
    "formula" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "monthly_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_reports" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "reportDate" DATE NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "monthly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_values" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "columnId" UUID NOT NULL,
    "valueNumeric" DECIMAL(20,4),
    "valueText" TEXT,
    "valueDate" DATE,
    "valueBool" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnover_games" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "category" VARCHAR(64),
    "position" INTEGER NOT NULL DEFAULT 0,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "turnover_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnover_reports" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "reportDate" DATE NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "turnover_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnover_values" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turnover_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_assets" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "uploaderId" UUID NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "extension" VARCHAR(16) NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL,
    "size" BIGINT NOT NULL,
    "cdnUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" VARCHAR(64),
    "uploadDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorEmail" VARCHAR(191),
    "action" VARCHAR(64) NOT NULL,
    "module" VARCHAR(64) NOT NULL,
    "siteId" UUID,
    "entityType" VARCHAR(64),
    "entityId" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(45),
    "userAgent" TEXT,
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "userId" UUID NOT NULL,
    "siteId" UUID,
    "originalName" VARCHAR(255) NOT NULL,
    "fileUrl" TEXT,
    "fileSize" BIGINT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "module" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "filters" JSONB,
    "fileUrl" TEXT,
    "fileSize" BIGINT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_jobs" (
    "id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "userId" UUID NOT NULL,
    "filters" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" BIGINT,
    "fileUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "siteId" UUID,
    "description" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_externalId_key" ON "users"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "roles_level_idx" ON "roles"("level");

-- CreateIndex
CREATE INDEX "roles_deletedAt_idx" ON "roles"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "sites_code_key" ON "sites"("code");

-- CreateIndex
CREATE INDEX "sites_status_idx" ON "sites"("status");

-- CreateIndex
CREATE INDEX "sites_deletedAt_idx" ON "sites"("deletedAt");

-- CreateIndex
CREATE INDEX "sites_name_idx" ON "sites"("name");

-- CreateIndex
CREATE INDEX "user_sites_siteId_idx" ON "user_sites"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_columns_key_key" ON "monthly_columns"("key");

-- CreateIndex
CREATE INDEX "monthly_columns_position_idx" ON "monthly_columns"("position");

-- CreateIndex
CREATE INDEX "monthly_columns_deletedAt_idx" ON "monthly_columns"("deletedAt");

-- CreateIndex
CREATE INDEX "monthly_reports_reportDate_idx" ON "monthly_reports"("reportDate" DESC);

-- CreateIndex
CREATE INDEX "monthly_reports_siteId_reportDate_idx" ON "monthly_reports"("siteId", "reportDate" DESC);

-- CreateIndex
CREATE INDEX "monthly_reports_status_idx" ON "monthly_reports"("status");

-- CreateIndex
CREATE INDEX "monthly_reports_deletedAt_idx" ON "monthly_reports"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_reports_siteId_reportDate_key" ON "monthly_reports"("siteId", "reportDate");

-- CreateIndex
CREATE INDEX "monthly_values_columnId_reportId_idx" ON "monthly_values"("columnId", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_values_reportId_columnId_key" ON "monthly_values"("reportId", "columnId");

-- CreateIndex
CREATE UNIQUE INDEX "turnover_games_code_key" ON "turnover_games"("code");

-- CreateIndex
CREATE INDEX "turnover_games_position_idx" ON "turnover_games"("position");

-- CreateIndex
CREATE INDEX "turnover_games_category_idx" ON "turnover_games"("category");

-- CreateIndex
CREATE INDEX "turnover_games_deletedAt_idx" ON "turnover_games"("deletedAt");

-- CreateIndex
CREATE INDEX "turnover_reports_reportDate_idx" ON "turnover_reports"("reportDate" DESC);

-- CreateIndex
CREATE INDEX "turnover_reports_siteId_reportDate_idx" ON "turnover_reports"("siteId", "reportDate" DESC);

-- CreateIndex
CREATE INDEX "turnover_reports_status_idx" ON "turnover_reports"("status");

-- CreateIndex
CREATE INDEX "turnover_reports_deletedAt_idx" ON "turnover_reports"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "turnover_reports_siteId_reportDate_key" ON "turnover_reports"("siteId", "reportDate");

-- CreateIndex
CREATE INDEX "turnover_values_gameId_reportId_idx" ON "turnover_values"("gameId", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "turnover_values_reportId_gameId_key" ON "turnover_values"("reportId", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "image_assets_fileName_key" ON "image_assets"("fileName");

-- CreateIndex
CREATE INDEX "image_assets_siteId_uploadDate_idx" ON "image_assets"("siteId", "uploadDate" DESC);

-- CreateIndex
CREATE INDEX "image_assets_uploaderId_uploadDate_idx" ON "image_assets"("uploaderId", "uploadDate" DESC);

-- CreateIndex
CREATE INDEX "image_assets_uploadDate_idx" ON "image_assets"("uploadDate" DESC);

-- CreateIndex
CREATE INDEX "image_assets_siteId_checksum_idx" ON "image_assets"("siteId", "checksum");

-- CreateIndex
CREATE INDEX "image_assets_deletedAt_idx" ON "image_assets"("deletedAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_module_createdAt_idx" ON "audit_logs"("module", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_siteId_createdAt_idx" ON "audit_logs"("siteId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "import_jobs_userId_createdAt_idx" ON "import_jobs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "import_jobs_createdAt_idx" ON "import_jobs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "export_jobs_status_idx" ON "export_jobs"("status");

-- CreateIndex
CREATE INDEX "export_jobs_userId_createdAt_idx" ON "export_jobs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "download_jobs_status_idx" ON "download_jobs"("status");

-- CreateIndex
CREATE INDEX "download_jobs_userId_createdAt_idx" ON "download_jobs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "download_jobs_expiresAt_idx" ON "download_jobs"("expiresAt");

-- CreateIndex
CREATE INDEX "settings_siteId_idx" ON "settings"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_siteId_key" ON "settings"("key", "siteId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sites" ADD CONSTRAINT "user_sites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sites" ADD CONSTRAINT "user_sites_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_values" ADD CONSTRAINT "monthly_values_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "monthly_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_values" ADD CONSTRAINT "monthly_values_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "monthly_columns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnover_reports" ADD CONSTRAINT "turnover_reports_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnover_values" ADD CONSTRAINT "turnover_values_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "turnover_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnover_values" ADD CONSTRAINT "turnover_values_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "turnover_games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_assets" ADD CONSTRAINT "image_assets_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_assets" ADD CONSTRAINT "image_assets_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
