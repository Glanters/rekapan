# Product Requirements Document

**Enterprise Monthly & Turnover Management System**

|                            |                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Status                     | Foundation stage — schema, seed, config, auth core, and site-scoping exist; no routes, UI, or jobs |
| Audience                   | Engineers joining the project, and the customer stakeholders who signed off on scope               |
| Source of truth for data   | `prisma/schema.prisma`                                                                             |
| Source of truth for config | `src/lib/env.ts`, `.env.example`                                                                   |
| Source of truth for RBAC   | `src/server/auth/permissions.ts`                                                                   |

> **Build status.** This document describes the product as agreed. The **server core** is built:
> schema and seed, validated environment, the Account Center crypto port and HTTP client, the login
> pipeline and activation gate, sessions, the 48-permission catalogue with six role presets, and
> the site-scoping tripwire. **Not built: any route handler, any UI beyond the `create-next-app`
> scaffold, any background job, any storage code, and `prisma/migrations/` — so none of it has run
> against a database yet.** Every requirement below is marked **[BUILT]**, **[PARTIAL]**, or
> **[PLANNED]**. See [Appendix A](#appendix-a--what-actually-exists-today) for the verified
> inventory.

---

## 1. Problem statement

The customer operates a portfolio of **sites** (100+ target) that each produce a daily set of
financial figures — deposit, withdraw, turnover, bonuses, adjustments, and derived measures such
as profit — plus a per-game turnover breakdown, plus a stream of screenshots and documents that
evidence those figures.

Today that work is spread across spreadsheets and shared folders. This creates four concrete
failures:

1. **No isolation.** A spreadsheet handed to an operator for one site exposes every other site in
   the workbook. There is no mechanism to say "this person sees Jakarta and Bandung, and nothing
   else." Access control is a social convention, not a system property.
2. **Schema drift.** When the business adds a new figure to track, every historical workbook has a
   different column layout. Comparing this month to last month becomes manual reconciliation.
3. **No audit trail.** When a number changes, there is no record of who changed it, when, or what
   it was before. Disputes are unresolvable.
4. **Identity sprawl.** The customer already runs an **Account Center** that owns credentials for
   their staff. Every new internal tool that invents its own password store adds another set of
   credentials to leak and another offboarding step to forget.

This system replaces that with a single application that records the figures, enforces per-site
access, keeps a full audit trail, and delegates credential verification to the existing Account
Center **without** delegating authorisation to it.

### 1.1 The identity decision, stated plainly

**Account Center is an identity provider only.** It answers exactly one question: _are these
credentials valid?_ It does not tell this application who the user is allowed to be, what they may
do, or which sites they may see.

This application owns **all** authorisation: roles, permissions, sites, the user→site mapping, and
activation status. The consequence is the single most important security property of the system:

> A user who authenticates successfully at Account Center but has no local record is
> auto-provisioned into `users` with `status = PENDING` and is **denied access**. Only an
> administrator can move them to `ACTIVE` and assign sites via `user_sites`.
>
> **A leaked Account Center credential grants nothing here.**

This is not a defence-in-depth nicety bolted on afterwards; it is the reason the split exists.
See `docs/AUTH-FLOW.md` for the mechanism.

---

## 2. Goals

| #   | Goal                                                                         | How we know it is met                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Per-site data isolation that cannot be bypassed by forgetting a filter       | **[BUILT]** A query against a site-owned table without a site constraint is _refused_ by the `scopedDb` tripwire, not silently run. Asserted in `src/server/db/site-scope.test.ts` (see `docs/ARCHITECTURE.md` §5) |
| G2  | Business users add tracked figures without a migration or a deploy           | Inserting a row into `monthly_columns` or `turnover_games` changes the UI, the import template, and the export                                                                                                     |
| G3  | Credentials stay in Account Center; authorisation stays here                 | No password column exists anywhere in `prisma/schema.prisma`; `ROOT_PASSWORD` is deliberately absent from `.env.example`                                                                                           |
| G4  | Every mutation is attributable                                               | `audit_logs` records actor, before/after JSON diff, IP, and `requestId`                                                                                                                                            |
| G5  | The system stays responsive at target scale                                  | See §6.1 performance targets — 100+ sites, 500+ users, millions of `monthly_values` / `turnover_values` rows, 100k+ `image_assets`                                                                                 |
| G6  | Bulk operations never block a request thread                                 | Imports, exports, and large ZIP downloads run as BullMQ jobs tracked in `import_jobs`, `export_jobs`, `download_jobs`                                                                                              |
| G7  | The Account Center integration cannot silently drift from the customer's PHP | Golden vectors generated from the real PHP library are asserted in CI (`src/lib/account-center/crypto.test.ts`)                                                                                                    |

## 3. Non-goals

These are deliberate exclusions, not deferred work. Reopening them requires a scope conversation.

| #   | Non-goal                                          | Reason                                                                                                                                                                                                                          |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NG1 | This app does **not** store or verify passwords   | Account Center owns credentials. A second auth path would be weaker than the one it sits beside and outside the customer's audit trail. This is why `ROOT_PASSWORD` was removed from the spec — see the note in `.env.example`. |
| NG2 | This app does **not** manage Account Center users | No user creation, password reset, or profile editing is proxied upstream. Those live in Account Center's own UI.                                                                                                                |
| NG3 | No real-time collaborative editing of a report    | Last-write-wins with an audit trail, not CRDTs or operational transforms.                                                                                                                                                       |
| NG4 | No accounting-grade ledger semantics              | This records and analyses reported figures. It is not a double-entry system and produces no statutory financial statements.                                                                                                     |
| NG5 | No mobile native app                              | Responsive web only.                                                                                                                                                                                                            |
| NG6 | No multi-tenancy beyond sites                     | One deployment serves one customer. Sites are not tenants; they share a database, a role catalogue, and a `monthly_columns` definition set.                                                                                     |

---

## 4. Personas

The six roles map to `roles.key` values. `roles.level` encodes authority — **lower number means
more authority** — and is used to stop a user from granting or editing a role at or above their
own level. `roles.isSystem` marks roles that the UI must refuse to rename or delete.

**[BUILT]** — defined as `ROLE_PRESETS` in `src/server/auth/permissions.ts` and written by
`prisma/seed.ts`, which seeds all six with `isSystem: true`.

| Persona                                                              | `roles.key`   | `level` | Permissions          | Site scope                         |
| -------------------------------------------------------------------- | ------------- | ------- | -------------------- | ---------------------------------- |
| **Root** — the platform owner; one account, seeded from `ROOT_EMAIL` | `ROOT`        | 0       | `'*'` (all 48)       | **Bypasses site scoping entirely** |
| **Super Admin** — trusted operations lead                            | `SUPER_ADMIN` | 10      | 43 of 48, enumerated | Assigned sites only                |
| **Manager** — owns a group of sites commercially                     | `MANAGER`     | 20      | 25                   | Assigned sites only                |
| **Supervisor** — reviews and approves what operators enter           | `SUPERVISOR`  | 30      | 17                   | Assigned sites only                |
| **Operator** — enters the daily figures and uploads evidence         | `OPERATOR`    | 40      | 13                   | Assigned sites only                |
| **Viewer** — read-only stakeholder                                   | `VIEWER`      | 50      | 8                    | Assigned sites only                |

Only Root is `'*'`. Super Admin is enumerated deliberately: if it inherited every future permission
automatically, adding a sensitive capability would silently widen an existing role rather than
requiring a decision. Presets are starting points — administrators reassign permissions through the
role editor afterwards.

### 4.1 Persona detail

**Root.** Bootstraps the system. Identified by matching the authenticated email against
`ROOT_EMAIL`; this is the one account activated automatically on first login. Root is the only
principal permitted to bypass `user_sites` filtering, the only one who can edit system roles, and
the only one who can promote another user to Super Admin. Root sees every site's data by
construction, not by being assigned to all of them — so adding a new site never requires touching
Root's assignments.

**Super Admin.** Day-to-day administration: activating `PENDING` users, assigning sites, editing
`monthly_columns` and `turnover_games`, managing `sites`, and reading `audit_logs`. Crucially,
**Super Admin is still site-scoped for report data.** They administer the system but they do not
automatically see every site's figures. Granting a Super Admin visibility over a site is an
explicit `user_sites` row, and that act is itself audited.

**Manager.** Consumes the dashboard and the analytical views across their assigned sites. Can
approve reports (`monthly_reports.status` → `APPROVED`) and lock them (`LOCKED`). Cannot change
master data or user access.

**Supervisor.** Reviews what Operators submit. Moves `monthly_reports.status` from `SUBMITTED` to
`APPROVED`, or back to `DRAFT` with a note in `monthly_reports.note`. Cannot lock.

**Operator.** The primary daily user. Creates and edits `monthly_reports` and `turnover_reports`
for assigned sites while they are in `DRAFT`, submits them, and uploads evidence to the gallery.
Cannot approve their own work.

**Viewer.** Reads dashboards, tables, and the gallery for assigned sites. Can export. Cannot
mutate anything.

### 4.2 Permission model

**[BUILT]** — `PERMISSIONS` in `src/server/auth/permissions.ts` is one `as const` array driving
three things at once: the `PermissionKey` union the type checker enforces at every guard, the rows
the seed inserts into `permissions`, and the grouping the role editor renders. Deriving them from a
single declaration is what stops a permission from being checked in code but missing from the
database — which fails open in the worst way, because the guard silently passes when nobody holds a
permission that does not exist.

48 permissions across 11 modules:

| Module    | Keys                                                                                   |
| --------- | -------------------------------------------------------------------------------------- |
| Dashboard | `dashboard.view`, `dashboard.export`                                                   |
| Monthly   | `monthly.view/create/update/delete/approve/import/export`                              |
| Turnover  | `turnover.view/create/update/delete/approve/import/export`                             |
| Gallery   | `gallery.view/upload/delete/download`, `gallery.download.bulk`, `gallery.download.all` |
| Site      | `site.view/create/update/delete`                                                       |
| Game      | `game.view/create/update/delete`                                                       |
| Column    | `column.view/create/update/delete`                                                     |
| User      | `user.view/activate/update/suspend/delete`, `user.assign_site`                         |
| Role      | `role.view/create/update/delete`                                                       |
| Audit     | `audit.view`, `audit.export`                                                           |
| Setting   | `setting.view`, `setting.update`                                                       |

**Two checks, always both.** A permission answers _"may this user perform this kind of action?"_
Site scope answers _"on which rows?"_ Neither substitutes for the other. Holding `monthly.update`
does not grant access to a site the user is not assigned to.

---

## 5. Functional requirements

Every requirement in this section is **[PLANNED]** unless marked otherwise. No route handlers,
services, repositories, or UI components exist in the repository today.

### 5.1 Dashboard

| ID       | Requirement                                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-DSH-1 | Present aggregate KPIs across the caller's accessible sites for a selected date range: totals per `monthly_columns` row where `includeInTotals = true`.                                   |
| FR-DSH-2 | Trend charts (Recharts) over `monthly_reports.reportDate`, one series per selected column, respecting `monthly_columns.dataType` and `precision` for formatting.                          |
| FR-DSH-3 | Per-site comparison table ranking accessible `sites` by a chosen column.                                                                                                                  |
| FR-DSH-4 | Turnover composition breakdown by `turnover_games.category` (Slot, Live Game, Sportbook) and by individual game.                                                                          |
| FR-DSH-5 | Site selector defaults to _all sites the caller can see_. For Root this is every non-deleted, non-archived row in `sites`; for everyone else it is the set resolved through `user_sites`. |
| FR-DSH-6 | Date range presets (today, last 7 days, month to date, last month, custom) evaluated in the site's `sites.timezone`, defaulting to `Asia/Jakarta`.                                        |
| FR-DSH-7 | Dashboard aggregates may be served from cache. Cache keys **must** incorporate the caller's resolved site-ID set — see `docs/ARCHITECTURE.md` §7.                                         |

### 5.2 Monthly module

The daily financial figures. One `monthly_reports` row per site per day, enforced by
`@@unique([siteId, reportDate])`. Values are EAV rows in `monthly_values`, one per
`(reportId, columnId)` pair.

| ID       | Requirement                                                                                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-MON-1 | Grid view: rows are dates, columns are `monthly_columns` ordered by `position` and grouped by `group`, filtered to `isVisible = true`. Virtualised (TanStack Virtual) — a year of data across many columns must not render every cell.                   |
| FR-MON-2 | Create a report for a site and date. Violating `@@unique([siteId, reportDate])` must surface as "a report already exists for this date", not a raw constraint error.                                                                                     |
| FR-MON-3 | Inline cell editing writes to the value column selected by `monthly_columns.dataType`: `CURRENCY`/`DECIMAL`/`INTEGER`/`PERCENT` → `valueNumeric`; `TEXT` → `valueText`; `DATE` → `valueDate`; `BOOLEAN` → `valueBool`. Exactly one is populated per row. |
| FR-MON-4 | `monthly_columns.isRequired = true` blocks the `DRAFT` → `SUBMITTED` transition until a value is present.                                                                                                                                                |
| FR-MON-5 | Derived columns: when `monthly_columns.formula` is non-null the cell is computed from other column keys and is not hand-editable. Formula evaluation must be sandboxed — no arbitrary expression evaluation against user input.                          |
| FR-MON-6 | Status workflow on `monthly_reports.status`: `DRAFT` → `SUBMITTED` → `APPROVED` → `LOCKED`. Only `DRAFT` is editable. `LOCKED` is terminal and only Root or Super Admin may reverse it.                                                                  |
| FR-MON-7 | Monetary values use `Decimal(20,4)`. Money must never round-trip through a JavaScript `number`.                                                                                                                                                          |
| FR-MON-8 | Every mutation writes an `audit_logs` row with `before`/`after` field-level diffs.                                                                                                                                                                       |
| FR-MON-9 | Soft delete only: set `monthly_reports.deletedAt`. No hard deletes from the UI.                                                                                                                                                                          |

**Seeded columns [BUILT].** `prisma/seed.ts` loads the 23 columns from the customer's existing
spreadsheet, at sparse positions 10, 20, 30, …:

| Group     | Columns                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| Transaksi | `pl_bet`, `validasi`, `deposit`, `withdraw`, `hasil`                         |
| Form      | `form_deposit`, `form_withdraw` (both `INTEGER`, `precision: 0`)             |
| Kas       | `setor_kas`, `pinjaman_kas`                                                  |
| Turnover  | `turnover`, `turnover_slot`, `turnover_livegame`, `turnover_sportbook`       |
| Kekalahan | `kekalahan_slot`, `kekalahan_livegame`, `kekalahan_sportbook`                |
| Bonus     | `bonus_demo`, `promo`, `freechip`, `bonus_vip`, `bonus_deposit`, `bonus_kpi` |
| Lainnya   | `error`                                                                      |

Everything except the two `Form` counters is `CURRENCY` at `precision: 2`. These are starting values
only — the point of the EAV design is that administrators add and reorder columns afterwards, which
is why the seed's `update` clause deliberately leaves `position` and `label` alone: a reordering or
rename made through the UI must survive the next seed run.

### 5.3 Turnover module

Per-game turnover. Structurally parallel to Monthly but simpler: a game only ever carries a single
numeric amount, so `turnover_values` has one `amount Decimal(20,4)` column rather than a
four-column value union.

| ID       | Requirement                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-TRN-1 | Grid view: rows are dates, columns are `turnover_games` where `isActive = true`, ordered by `position`, grouped by `category`.                                                                                                                                      |
| FR-TRN-2 | One `turnover_reports` row per site per day (`@@unique([siteId, reportDate])`), values keyed by `@@unique([reportId, gameId])`.                                                                                                                                     |
| FR-TRN-3 | Row totals and per-category subtotals computed server-side in decimal arithmetic, never in the browser.                                                                                                                                                             |
| FR-TRN-4 | Same `ReportStatus` workflow, audit behaviour, and soft-delete rule as Monthly.                                                                                                                                                                                     |
| FR-TRN-5 | Deactivating a game (`isActive = false`) hides it from new entry but must not hide or alter historical `turnover_values`. This is why `turnover_values.gameId` uses `onDelete: Restrict` — a game with history cannot be deleted, only deactivated or soft-deleted. |

**Seeded games [BUILT].** Seven games from the customer's spreadsheet, all `category: 'Live Game'`,
at sparse positions 10–70: `POIPET`, `NEVADA`, `BRUNEI`, `CHELSEA`, `HUAHIN`, `BANGKOK`, `TOKYO`.
The Slot and Sportbook categories referenced in the grouped headers have no seeded games yet —
those are added through the UI once it exists.

### 5.4 Master data

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-MD-1 | **Sites** — CRUD over `sites`: `code` (short key, also the Excel import join key), `name`, `logoUrl`, `timezone`, `currency`, `status` (`ACTIVE`/`INACTIVE`/`ARCHIVED`). `sites.code` is unique and must be treated as stable; changing it breaks in-flight import templates. Five sample sites are seeded **[BUILT]**: `JKT` Jakarta, `BDG` Bandung, `BALI` Bali, `SBY` Surabaya, `MDN` Medan. |
| FR-MD-2 | **Users** — list `users` with `status`, role, and assigned site count. The primary workflow is the activation queue: everything in `status = PENDING`, oldest first.                                                                                                                                                                                                                            |
| FR-MD-3 | **Activation** — moving a user to `ACTIVE` stamps `activatedAt` and `activatedById`. The UI must require at least one `user_sites` assignment in the same action, because an `ACTIVE` user with no sites can log in and see nothing, which reads as a bug.                                                                                                                                      |
| FR-MD-4 | **Site assignment** — add/remove `user_sites` rows, stamping `assignedById` and `assignedAt`. Every change is audited.                                                                                                                                                                                                                                                                          |
| FR-MD-5 | **Roles** — CRUD over `roles` and `role_permissions`. A user may never create, edit, or assign a role whose `level` is less than or equal to their own. `isSystem = true` roles cannot be renamed or deleted.                                                                                                                                                                                   |
| FR-MD-6 | **Monthly columns** — CRUD over `monthly_columns`. `position` is sparse (10, 20, 30) so a column can be inserted between two others without renumbering. `isSystem = true` columns cannot be deleted. Deleting a column that has `monthly_values` is blocked by `onDelete: Restrict`; the UI offers `isVisible = false` instead.                                                                |
| FR-MD-7 | **Turnover games** — CRUD over `turnover_games`, same position/deactivation semantics.                                                                                                                                                                                                                                                                                                          |

### 5.5 Gallery and upload

Metadata lives in `image_assets`; bytes live in S3-compatible object storage. The table never holds
image data.

| ID       | Requirement                                                                                                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-GAL-1 | Upload one or more files against a site and an `uploadDate`. `uploadDate` is the _business_ date and defaults to today but is user-settable, because backfilled uploads carry their original date — it is deliberately not the same as `createdAt`. |
| FR-GAL-2 | Reject files above `MAX_UPLOAD_SIZE_MB` (default 25) before the bytes are stored.                                                                                                                                                                   |
| FR-GAL-3 | Compute a SHA-256 into `image_assets.checksum` and warn on duplicates within the same site, served by the `[siteId, checksum]` index. Duplicates are flagged, not blocked — the same screenshot legitimately recurs.                                |
| FR-GAL-4 | Generate a thumbnail (`sharp`) into `thumbnailUrl` and record `width`/`height`. Thumbnail generation runs as a background job so a slow resize never blocks the upload response.                                                                    |
| FR-GAL-5 | Masonry/grid browser filtered by site, date range, and uploader, paginated via the `[siteId, uploadDate DESC]` index.                                                                                                                               |
| FR-GAL-6 | Lightbox preview with metadata: `originalName`, `size`, dimensions, uploader, `uploadDate`.                                                                                                                                                         |
| FR-GAL-7 | Soft delete sets `deletedAt`. Object-storage bytes are removed only by a separate sweeper, so an accidental delete is recoverable for a retention window.                                                                                           |
| FR-GAL-8 | `image_assets.fileName` (the storage object key) is globally unique and generated, never derived from `originalName` — user-supplied filenames are a path-traversal and collision vector.                                                           |

### 5.6 Download / ZIP

| ID      | Requirement                                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-DL-1 | Select images by filter (site, date range, uploader) or by explicit selection and download them as a ZIP.                                                                                          |
| FR-DL-2 | Selections of **≤ `ZIP_SYNC_THRESHOLD`** items (default 50) stream synchronously via `archiver`.                                                                                                   |
| FR-DL-3 | Selections above the threshold create a `download_jobs` row and are handed to BullMQ, so a request never holds a connection open for minutes.                                                      |
| FR-DL-4 | Job progress is visible to the user: `status`, `itemCount`, `sizeBytes`, and `error` on failure.                                                                                                   |
| FR-DL-5 | The archive URL lands in `download_jobs.fileUrl` with an `expiresAt`. A sweeper deletes expired archives — they are disposable by design.                                                          |
| FR-DL-6 | The item set is resolved **under the requester's site scope at job creation time**, and re-verified in the worker. A job must never widen access simply because it runs outside a request context. |

### 5.7 Import / export

| ID       | Requirement                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-IMP-1 | Download an Excel template generated from the live `monthly_columns` / `turnover_games` definitions, so the template can never drift from the schema.                                                                                                |
| FR-IMP-2 | Upload an `.xlsx` to create an `import_jobs` row with `kind` (`MONTHLY` \| `TURNOVER`), processed by a BullMQ worker via `exceljs`.                                                                                                                  |
| FR-IMP-3 | Rows join to a site by `sites.code`, not by UUID — operators type the code.                                                                                                                                                                          |
| FR-IMP-4 | Import is **idempotent** on `(siteId, reportDate)`. Re-uploading the same file updates the existing report rather than creating a duplicate; the unique constraint is the guard.                                                                     |
| FR-IMP-5 | Per-row validation failures are collected into `import_jobs.errors` (JSONB) with row number and reason, and counted into `totalRows` / `successRows` / `failedRows`, so the operator can fix and re-upload. A bad row must not abort the whole file. |
| FR-IMP-6 | The importer must reject rows for sites outside the requester's scope, and record them as failures rather than silently skipping them.                                                                                                               |
| FR-EXP-1 | Export Monthly, Turnover, gallery metadata, or audit logs as `XLSX`, `CSV`, or `PDF` (`export_jobs.format`).                                                                                                                                         |
| FR-EXP-2 | The exact filter set is persisted to `export_jobs.filters` (JSONB) so a result can be reproduced or audited later.                                                                                                                                   |
| FR-EXP-3 | Exports run as background jobs with `rowCount`, `fileUrl`, and `expiresAt`; expired files are swept.                                                                                                                                                 |

### 5.8 Audit log

| ID       | Requirement                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-AUD-1 | Every create, update, delete, status transition, login, activation, and permission change writes an `audit_logs` row.                                                                                                    |
| FR-AUD-2 | Records `actorId`, `actorEmail` (denormalised so the trail survives deletion of the user row), `action`, `module`, `siteId`, `entityType`, `entityId`, `before`/`after` JSONB diffs, `ip`, `userAgent`, and `requestId`. |
| FR-AUD-3 | `requestId` correlates every log line emitted while handling one HTTP request, including the rows written by background jobs that request enqueued.                                                                      |
| FR-AUD-4 | Append-only. No UI path updates or deletes an `audit_logs` row.                                                                                                                                                          |
| FR-AUD-5 | Viewer UI filtered by actor, module, entity, site, and date range, served by the composite `createdAt DESC` indexes.                                                                                                     |
| FR-AUD-6 | Secrets and credentials are redacted **before** they reach `before`/`after`. The audit log must never become a secret store.                                                                                             |
| FR-AUD-7 | Audit visibility is itself site-scoped: a non-Root user sees only rows whose `siteId` is in their scope, plus their own actions.                                                                                         |

### 5.9 Settings

| ID       | Requirement                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-SET-1 | Key/value settings in `settings`, JSONB values, unique on `(key, siteId)`.                                                                                                                                                                                                                                                            |
| FR-SET-2 | A row with `siteId = NULL` is the global default; a row with a `siteId` overrides it for that site. Resolution is: site-specific row, else global row, else code default.                                                                                                                                                             |
| FR-SET-3 | `settings.isSecret = true` values are write-only in the UI (never rendered back) and redacted from `audit_logs`.                                                                                                                                                                                                                      |
| FR-SET-4 | Settings are cached and invalidated on write.                                                                                                                                                                                                                                                                                         |
| FR-SET-5 | Infrastructure configuration stays in environment variables validated by `src/lib/env.ts` and is **never** moved into `settings`. `settings` is for business configuration a Super Admin may change at runtime; env is for things that require a deploy. Keeping the boundary sharp is what makes `env.ts` a reliable boot-time gate. |

---

## 6. Non-functional requirements

### 6.1 Performance

Targets, not measurements — nothing has been benchmarked because nothing is built. They exist to
be tested against once the first vertical slice lands.

| Metric                                                | Target                                 | Notes                                                                                                        |
| ----------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Dashboard aggregate, p95                              | < 1200 ms cold, < 300 ms cached        | Depends on the materialised views described in `docs/ERD.md` §4                                              |
| Monthly/Turnover grid page (one month, one site), p95 | < 500 ms                               | Served by `[siteId, reportDate DESC]`                                                                        |
| Table interaction (sort/filter/page)                  | < 200 ms                               | Server-side pagination; never fetch a full table into the client                                             |
| Login round trip                                      | < 2000 ms                              | Bounded by `ACCOUNT_CENTER_TIMEOUT_MS`, default 15000 ms, which is the hard ceiling before the request fails |
| Gallery page (48 thumbnails)                          | < 800 ms                               | Served by `[siteId, uploadDate DESC]`; thumbnails from CDN, never originals                                  |
| Import throughput                                     | ≥ 1000 rows/minute                     | Batched writes inside a transaction                                                                          |
| Synchronous ZIP                                       | ≤ `ZIP_SYNC_THRESHOLD` items, streamed | Above that it is a job by definition                                                                         |

**Scale targets.** 100+ rows in `sites`; 500+ rows in `users`; millions of rows in
`monthly_values` and `turnover_values`; hundreds of thousands of rows in `image_assets`;
`audit_logs` growing without bound.

**Scale consequences already designed into the schema:**

- **UUIDv7 primary keys** everywhere (`@default(uuid(7))`). v7 is time-ordered, so inserts land at
  the right edge of the B-tree. Random v4 keys scatter page splits across the whole index and
  bloat it badly at these row counts.
- **Covering index `[columnId, reportId]`** on `monthly_values` (and `[gameId, reportId]` on
  `turnover_values`) exists specifically because dashboard rollups filter by column across many
  reports, which the report-first unique index cannot serve.
- **`audit_logs` is a partitioning candidate** — the plan is monthly `RANGE` partitions on
  `createdAt` in a follow-up SQL migration. **[PLANNED]**
- **Partial indexes** — Prisma cannot express `WHERE deleted_at IS NULL`, so those variants are
  added in raw SQL migrations. Without them every lookup pays for rows nobody can see.
  **[PLANNED]**

### 6.2 Security

| ID         | Requirement                                                                                                                                                                                    | Status                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC-1  | No password is ever stored by this application. `prisma/schema.prisma` contains no credential column.                                                                                          | **[BUILT]** — verifiable by inspection                                                                                                             |
| NFR-SEC-2  | Authentication delegates to Account Center over an AES-256-CBC signed request. The port is asserted byte-for-byte against the customer's real PHP library.                                     | **[BUILT]** — `src/lib/account-center/`, `crypto.test.ts`                                                                                          |
| NFR-SEC-3  | The activation gate: authenticated-but-not-`ACTIVE` is denied. A leaked upstream credential grants nothing.                                                                                    | **[BUILT]** — `src/server/auth/login.ts`; re-checked on every request in `resolveSession()`                                                        |
| NFR-SEC-4  | Sessions are server-side. The browser holds only an opaque id in an httpOnly cookie; `sessions.tokenHash` stores SHA-256 of that value so a database leak yields no live sessions.             | **[BUILT]** — `src/server/auth/session.ts`, cookie `mt_session`, 32 random bytes                                                                   |
| NFR-SEC-5  | The upstream Account Center JWT is encrypted at rest with AES-GCM into `sessions.accountCenterToken` using `ENCRYPTION_KEY`, and never travels to the browser.                                 | **[BUILT]** — `src/server/crypto/at-rest.ts`, format `v1.<iv>.<tag>.<ciphertext>`                                                                  |
| NFR-SEC-6  | Site scoping cannot be forgotten: a query against a site-owned table without a site constraint is refused.                                                                                     | **[BUILT]** — `scopedDb` tripwire, `src/server/db/`. See `docs/ARCHITECTURE.md` §5                                                                 |
| NFR-SEC-7  | `src/lib/env.ts` throws if imported into a browser bundle, turning an accidental secret leak into a build-time failure.                                                                        | **[BUILT]**                                                                                                                                        |
| NFR-SEC-8  | Configuration is validated at boot and reports every problem at once, so a misconfigured deployment fails at start rather than at 3am inside whichever request first touched the bad variable. | **[BUILT]**                                                                                                                                        |
| NFR-SEC-9  | All input validated with Zod at the route boundary; TypeScript `strict` is on.                                                                                                                 | **[PARTIAL]** — `strict: true` set; no routes exist yet                                                                                            |
| NFR-SEC-10 | Uploads are validated by MIME type and size; storage keys are generated, never user-derived.                                                                                                   | **[PLANNED]**                                                                                                                                      |
| NFR-SEC-11 | Rate limiting on the login route. Account Center is a shared upstream; this app must not become a credential-stuffing amplifier against it.                                                    | **[PLANNED]** — `RateLimitError` exists; nothing raises it. **The most important remaining gap in the login path.**                                |
| NFR-SEC-12 | Secrets are redacted before entering `audit_logs` or application logs.                                                                                                                         | **[BUILT]** — key-name redaction in `audit/record.ts` and `logger.ts`                                                                              |
| NFR-SEC-13 | Session lifetime is bounded by `SESSION_TTL_HOURS` (default 12).                                                                                                                               | **[BUILT]** — set on both the row and the cookie. Note `SESSION_SECRET` is validated but **not yet consumed by any code**; wire it up or remove it |
| NFR-SEC-14 | Cross-site access on a point lookup reports 404, not 403, so record existence is not confirmed to a prober.                                                                                    | **[BUILT]** — `SiteAccessDeniedError`, with `isSecurityEvent` preserved internally for alerting                                                    |

### 6.3 Availability and operability

| ID        | Requirement                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-OPS-1 | Target 99.5% availability during business hours. Background job failure must degrade features, not the application.                                                                                                                                                     |
| NFR-OPS-2 | If Account Center is unreachable, **existing sessions continue to work** — session validation is local. Only new logins fail, with a clear error. This is a direct benefit of not proxying every request upstream.                                                      |
| NFR-OPS-3 | There is deliberately **no break-glass local login**. If Account Center is down, nobody logs in. `.env.example` documents this and offers to add a rate-limited, audited break-glass path as an explicit feature if the customer wants one. It is not silently present. |
| NFR-OPS-4 | Failed jobs retry with backoff and land in a dead-letter state visible in the `*_jobs` tables, not just in Redis.                                                                                                                                                       |
| NFR-OPS-5 | Redis runs with `maxmemory-policy noeviction`. Dropping a queued job under memory pressure would silently lose a user's export or archive. **[BUILT]** in `docker-compose.yml`.                                                                                         |
| NFR-OPS-6 | Postgres is initialised with `--locale=C` so index ordering is identical across developer machines and environments. **[BUILT]** in `docker-compose.yml`.                                                                                                               |
| NFR-OPS-7 | `log_min_duration_statement=500` in development surfaces slow queries before the EAV tables grow. **[BUILT]**.                                                                                                                                                          |
| NFR-OPS-8 | Production uses managed equivalents (RDS/Cloud SQL, ElastiCache, Cloudflare R2). Only connection strings change, because the app talks to MinIO through the same S3 API it uses against R2.                                                                             |

### 6.4 Accessibility, i18n, and browser support

| ID       | Requirement                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-UX-1 | WCAG 2.1 AA: keyboard navigation, visible focus, and contrast on all interactive elements. Data grids need real keyboard cell navigation, not just tab order. |
| NFR-UX-2 | Dark and light themes (`next-themes`).                                                                                                                        |
| NFR-UX-3 | Currency rendered per `sites.currency` (default `IDR`); dates and date-range presets evaluated in `sites.timezone` (default `Asia/Jakarta`).                  |
| NFR-UX-4 | Latest two versions of Chrome, Edge, Firefox, Safari. No IE, no legacy Edge.                                                                                  |

---

## 7. Out of scope

Explicitly not built, now or under this scope:

1. **Password management of any kind** — no local passwords, no reset, no MFA enrolment. MFA, if
   required, is Account Center's responsibility.
2. **Provisioning users into Account Center** — this app can only react to accounts that already
   exist upstream.
3. **Real-time multi-user cell-level collaboration** on the same report.
4. **Automated ingestion from upstream financial APIs.** Data arrives by manual entry or Excel
   import only.
5. **Statutory financial reporting, tax computation, or general-ledger export.**
6. **Native mobile applications.**
7. **Customer-facing or public portal.** Every route is behind authentication.
8. **Cross-customer multi-tenancy.** One deployment, one customer.
9. **Video or arbitrary document storage in the gallery.** Images only, bounded by
   `MAX_UPLOAD_SIZE_MB`.
10. **Automatic anomaly detection or forecasting.** The dashboard aggregates and visualises; it
    does not predict.
11. **Editing `LOCKED` reports through the normal workflow.** Reversal is a privileged, audited
    action, not a feature of the editing UI.
12. **Break-glass local authentication** — see NFR-OPS-3. Available as an explicit future feature
    on request; deliberately absent today.

---

## 8. Milestones

Ordered by dependency, not by estimate. No dates — the point is the sequence.

| #      | Milestone                                                                                                    | Status       | Unblocks                                    |
| ------ | ------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------- |
| M0     | Schema, env validation, Account Center crypto with PHP parity tests, Docker stack                            | **BUILT**    | Everything                                  |
| M1     | Seed (48 permissions, 6 roles, sites, columns, games, Root), Prisma client with driver adapter               | **BUILT**    | Any database work                           |
| M2     | Auth core: Account Center client, login pipeline, activation gate, sessions, at-rest crypto                  | **BUILT**    | Every authenticated route                   |
| M3     | Scope + RBAC primitives: `AccessContext`, `scopedDb` tripwire, audit writer, error taxonomy, logger          | **BUILT**    | Every data module                           |
| **M4** | **Initial migration** — `prisma/migrations/` does not exist, so none of the above has run against a database | **BLOCKING** | Literally everything downstream             |
| M5     | Login route + logout + `middleware.ts` + login UI + rate limiting                                            | Next         | A usable application                        |
| M6     | Master data: sites, users, activation queue, site assignment, roles                                          |              | Making the system usable by anyone but Root |
| M7     | Monthly module end to end                                                                                    |              | Turnover (near-identical shape)             |
| M8     | Turnover module                                                                                              |              | Dashboard                                   |
| M9     | Gallery + upload + storage abstraction                                                                       |              | Download/ZIP                                |
| M10    | BullMQ infrastructure + import/export/ZIP workers                                                            |              | Bulk operations                             |
| M11    | Dashboard + materialised views + partial-index/partitioning SQL migrations                                   |              | Performance targets                         |
| M12    | Audit viewer, settings UI, remaining hardening                                                               |              | Production readiness                        |

---

## Appendix A — What actually exists today

Verified by inspection of the repository, not aspirational.

**Present and complete:**

| Path                                    | What it is                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `prisma/schema.prisma`                  | All 19 models and 7 enums, with design rationale in the header                       |
| `prisma/seed.ts`                        | Idempotent seed: 48 permissions, 6 roles, 5 sites, 23 Monthly columns, 7 games, Root |
| `src/lib/env.ts`                        | Zod-validated server environment; throws if imported client-side                     |
| `src/lib/account-center/crypto.ts`      | AES-256-CBC port of the customer's `AesCbc256` PHP library                           |
| `src/lib/account-center/php-json.ts`    | Byte-for-byte reproduction of PHP `json_encode()` defaults                           |
| `src/lib/account-center/signing.ts`     | `buildLoginRequest()` — body, IV, and the three headers                              |
| `src/lib/account-center/crypto.test.ts` | Parity suite asserted against PHP golden vectors                                     |
| `src/server/account-center/client.ts`   | The HTTP call, timeout handling, response decryption and normalisation               |
| `src/server/auth/access-context.ts`     | `AccessContext`, `SiteScope`, permission and site guards                             |
| `src/server/auth/login.ts`              | The login pipeline and the activation gate                                           |
| `src/server/auth/permissions.ts`        | The 48-permission catalogue and the six role presets                                 |
| `src/server/auth/session.ts`            | Create / resolve / destroy / revoke; opaque `mt_session` cookie                      |
| `src/server/audit/record.ts`            | Sanitising, never-throwing audit writer                                              |
| `src/server/crypto/at-rest.ts`          | AES-256-GCM for secrets at rest, versioned for key rotation                          |
| `src/server/db/prisma.ts`               | `scopedDb` tripwire and `unsafeDb`, Prisma 7 driver adapter, pooling                 |
| `src/server/db/site-scope.ts`           | Scope registry, filter builders, the tripwire predicate                              |
| `src/server/db/site-scope.test.ts`      | Cross-site isolation suite, incl. schema-completeness check                          |
| `src/server/errors.ts`                  | Typed error taxonomy with status codes and `isOperational`                           |
| `src/server/logger.ts`                  | Redacting structured logger; the only sanctioned `console` boundary                  |
| `tools/php-parity/AesCbc256.php`        | Verbatim copy of the customer's production library                                   |
| `tools/php-parity/generate-vectors.php` | Golden-vector generator                                                              |
| `docker-compose.yml`                    | Postgres 17, Redis 7, MinIO + bucket bootstrap                                       |
| `.env.example`                          | Every variable `env.ts` validates, documented                                        |

**Absent — do not assume these exist:**

- **`prisma/migrations/` — the schema has never been applied to a database.** `npm run db:migrate`
  and `npm run db:seed` are defined, and `seed.ts` is written, but no migration has been generated.
  Nothing above has actually run. This is the blocking next step.
- Any route handler. `src/app/api/` does not exist; `login()` is written but nothing calls it.
- `middleware.ts`.
- Rate limiting. `RateLimitError` exists in the taxonomy and nothing raises it.
- Any service module. `src/server/services/` does not exist.
- Any UI beyond the default `create-next-app` scaffold (`src/app/page.tsx`, `layout.tsx`,
  `globals.css`). No shadcn/ui components are installed — the primitives
  (`class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `lucide-react`) are dependencies,
  but there is no `components.json` and no `src/components/`.
- Any BullMQ queue or worker. `bullmq` and `ioredis` are installed and unused.
- Any S3 wiring. `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are installed and unused.
- The raw SQL migrations for partial indexes, materialised views, and `audit_logs` partitioning.
- Any consumer of `SESSION_SECRET` — it is validated at boot and used by nothing.

**Two discrepancies worth knowing:**

1. Several source comments reference `tools/php-parity/AccountCenter.php` as the reference
   implementation for `login()`. **That file is not in the repository** — only `AesCbc256.php` and
   `generate-vectors.php` are. The login body construction it describes is reproduced in
   `generate-vectors.php` (the `$loginCases` loop), which is what the parity tests assert against,
   so the request format is verified. But the Account Center **endpoint path** is not: `client.ts`
   currently assumes `/auth/login`, which must be confirmed with the customer.
2. The schema header describes `createdById` / `updatedById` as "indexed UUID columns", but **no
   index is declared on any of them**. See `docs/ERD.md` §2.3 — resolve before the first migration.

---

## Related documents

- `docs/ARCHITECTURE.md` — layering, site-scope enforcement, jobs, storage, caching
- `docs/ERD.md` — every table, index, and the EAV tradeoff
- `docs/AUTH-FLOW.md` — the login sequence, the crypto protocol, and the RBAC rules
