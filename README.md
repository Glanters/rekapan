# Enterprise Monthly & Turnover Management System

Multi-site financial reporting: daily Monthly figures, per-game Turnover, and an
image gallery — with role-based permissions and strict per-site data isolation.

Authentication is delegated to an existing **Account Center**; authorisation
(roles, permissions, site membership, account activation) belongs to this
application. See [`docs/AUTH-FLOW.md`](docs/AUTH-FLOW.md).

## Documentation

| Document                                       | Contents                                              |
| ---------------------------------------------- | ----------------------------------------------------- |
| [`docs/PRD.md`](docs/PRD.md)                   | Product requirements, personas, scope                 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering, request lifecycle, folder structure         |
| [`docs/ERD.md`](docs/ERD.md)                   | Data model, indexes, the EAV design and its tradeoffs |
| [`docs/AUTH-FLOW.md`](docs/AUTH-FLOW.md)       | Login sequence, crypto protocol, RBAC, site scoping   |

## Stack

Next.js 15 (App Router) · TypeScript (strict) · PostgreSQL 17 · Prisma 7 ·
Tailwind v4 · shadcn/ui · TanStack Table + Query · React Hook Form + Zod ·
Zustand · Recharts · BullMQ + Redis · S3-compatible object storage

## Prerequisites

- Node.js 20+
- Docker Desktop
- PHP 8+ — optional, only to regenerate the Account Center parity fixtures

---

## Setup

### 1. Configure the environment

```bash
cp .env.example .env
```

Then fill in the three values that have no sensible default:

| Variable                   | Source                                             |
| -------------------------- | -------------------------------------------------- |
| `ACCOUNT_CENTER_URL`       | `services.accountcenter.uri` in the Laravel config |
| `ACCOUNT_CENTER_CLIENT_ID` | `services.accountcenter.name`                      |
| `ACCOUNT_CENTER_SECRET`    | `services.accountcenter.secret`                    |

`ACCOUNT_CENTER_SECRET` must match **byte for byte**. It is hashed to derive the
AES key, so one wrong character produces a signature the server rejects without
a useful diagnostic.

Also set `ROOT_EMAIL` to the Account Center account that should become Root.

### 2. Start the infrastructure

```bash
npm run docker:up      # Postgres, Redis, MinIO
```

### 3. Run migrations and seed

> **On Windows, run these through Docker.** See the note below on Smart App
> Control — the native `db:*` scripts will fail.

```bash
npm run docker:install   # once: populates the container's Linux node_modules
npm run docker:migrate   # creates the schema
npm run docker:seed      # roles, permissions, sites, columns, games, root user
```

On Linux or macOS the native equivalents work directly:

```bash
npm run db:migrate && npm run db:seed
```

### 4. Run the app

```bash
npm run dev
```

---

## Windows: Smart App Control blocks the Prisma engine

Prisma ships `schema-engine-windows.exe` **unsigned**. Windows Smart App Control
refuses to execute unsigned binaries, so `prisma migrate`, `migrate deploy`, and
`db push` all fail on the host with:

```
Error: spawn UNKNOWN
An Application Control policy has blocked this file
```

Check whether this affects you:

```powershell
(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
# 0 = off   1 = enforced   2 = evaluation
```

**The fix used here is the `docker:*` scripts**, which run the Prisma CLI inside
a Linux container against the same Postgres. Nothing about the host's security
configuration changes, and only the CLI is containerised — the Next.js dev
server still runs natively.

> Turning Smart App Control off is **irreversible**: it cannot be re-enabled
> without reinstalling Windows, and it protects every application on the
> machine, not just this one. The container route avoids that trade entirely.

---

## Scripts

### Development

| Script                      | Purpose            |
| --------------------------- | ------------------ |
| `npm run dev`               | Next.js dev server |
| `npm run build`             | Production build   |
| `npm run typecheck`         | `tsc --noEmit`     |
| `npm run lint` / `lint:fix` | ESLint             |
| `npm run format`            | Prettier           |
| `npm test`                  | Vitest             |

### Database — through Docker (required on Windows)

| Script                              | Purpose                                             |
| ----------------------------------- | --------------------------------------------------- |
| `npm run docker:up` / `docker:down` | Start / stop infrastructure                         |
| `npm run docker:install`            | Install the container's Linux `node_modules` (once) |
| `npm run docker:migrate`            | `prisma migrate dev`                                |
| `npm run docker:deploy`             | `prisma migrate deploy` (production)                |
| `npm run docker:seed`               | Seed roles, permissions, sites, columns, games      |
| `npm run docker:reset`              | Drop, re-migrate, re-seed                           |
| `npm run docker:sh`                 | Shell inside the tooling container                  |

### Database — native (Linux / macOS)

`db:migrate`, `db:deploy`, `db:seed`, `db:reset`, `db:studio`, `db:generate`

### Account Center parity

| Script                | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `npm run php:vectors` | Regenerate golden vectors from the original PHP library |

---

## Testing

```bash
npm test
```

Two suites carry most of the weight:

**`src/lib/account-center/crypto.test.ts`** asserts the TypeScript port of the
customer's `AesCbc256` PHP library against vectors generated by _running that
PHP library_. It pins the details that are easy to lose in a port: the md5 hex
digest used as 32 raw ASCII bytes, the double base64, the `encrypt`/`decrypt` IV
asymmetry, and PHP's `json_encode` escaping — which the signature covers, so it
must match byte for byte.

**`src/server/db/site-scope.test.ts`** covers per-site isolation, including the
case a naive implementation gets wrong: a site constraint inside an `OR` branch
looks like scoping but returns every site's rows, because a union widens the
result set. It also reads `prisma/schema.prisma` and fails if a model with a
`siteId` is neither registered as scoped nor explicitly excused.

---

## Project structure

```
prisma/
  schema.prisma          Data model, with design rationale in the header
  seed.ts                Idempotent seed
src/
  app/                   Next.js App Router
  lib/
    env.ts               Zod-validated environment, parsed at boot
    account-center/      Crypto port, PHP-compatible JSON, request signing
  server/
    auth/                Access context, permissions, sessions, login gate
    db/                  Prisma client and the site-scoping tripwire
    account-center/      HTTP client
    audit/               Audit trail
    crypto/              AES-GCM encryption at rest
  generated/prisma/      Generated client — do not edit
tools/php-parity/        The original PHP library + fixture generator
docs/                    PRD, architecture, ERD, auth flow
```

## Security notes

- **Account Center never grants access on its own.** A successful upstream login
  for an unknown user creates a `PENDING` record and is refused. An
  administrator must activate the account and assign sites.
- **Site scoping fails loudly.** Queries against site-owned tables that lack a
  top-level site constraint raise `UnscopedQueryError` rather than running.
- **Cross-site access returns 404, not 403**, so a caller cannot confirm that
  another site's record exists.
- **Sessions are opaque.** The browser holds a random identifier; roles and
  permissions are read from the database per request, so revocation is
  immediate.
- **Upstream tokens are encrypted at rest** with AES-256-GCM.
