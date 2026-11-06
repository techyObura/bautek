# Bautek Flink — MERN backend

A complete **backend starter implementation** for the supplied Bautek React (`App.jsx` / `Auth.jsx`) application. It is a runnable Express + MongoDB/Mongoose REST API with JWT authentication and server-side authorisation, not a claim of production certification. The frontend remains your existing React + Vite application. The backend is independent: it never serves the frontend or changes its styling.

## Features included

- **Identity:** public client registration, email/password login with bcrypt, 15-minute access JWTs, rotating HTTP-only refresh tokens, logout, session revocation on role changes, authenticated profile editing.
- **Roles:** `client`, `contractor`, `admin`, `super_admin`, `tenant`; public users cannot register themselves as privileged roles. The initial super admin is provisioned by an explicit bootstrap command.
- **Professional profiles:** administrators can fill specialties, professional registration, experience and biography. Profiles must be complete before project assignment.
- **Client projects:** submission, read permissions by ownership/team, super-admin approval/rejection, multi-admin/multi-responsibility assignments, audit trail.
- **Properties:** registration against an approved property project, linked owner, assigned admins, per-property visibility.
- **Tenants:** must be linked to a genuine tenant account and managed property; prevent duplicate active account/unit occupancy, admin removal request, super-admin removal or reinstatement (soft-deactivation rather than deleting history).
- **Rent:** reference uniqueness and manual receipt entry, **pending verification** until a super admin confirms evidence; reversal and audit records; monthly rent, credits, arrears, collection rating, landlord property income, expenses and remittances computed server-side. No M-Pesa disbursement is simulated.
- **Other frontend collections:** listings, bids, deliverables, documents metadata, messages, notifications, tenders, transactions, settings, users, audits. Indexed by string `id` compatible with the current UI.
- **Operational controls:** CORS allowlist, Helmet, auth rate limit, input picklists, audited mutations, bounded collection reads, no self-elevation, duplicate reference protection.

## Quick start (Node.js 20+)

```bash
cd BAUTEK_MERN_Backend
cp .env.example .env
# Edit .env with 2 different random JWT secrets >=32 characters.
# Example: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
docker compose up -d mongo
npm install
npm run check
npm test
# Set BOOTSTRAP_SUPERADMIN_EMAIL and BOOTSTRAP_SUPERADMIN_PASSWORD in .env
npm run seed
npm run dev
```

Open `http://localhost:5000/api/v1/health`. It returns `status: ok` once MongoDB is connected.

**Development-only sample records:** `npm run seed -- --demo` (requires bootstrap credentials; refuses `NODE_ENV=production`). The demo client, admin, tenant and contractor accounts use `DemoPass12345!`, which must **never** be used in real deployments. Run sample seeds only on a development database.

### Vite frontend configuration

Place this in the **frontend project** `.env`, not the backend `.env`:

```dotenv
VITE_API_URL=http://localhost:5000/api/v1
VITE_DEMO_MODE=false
```

Restart Vite. In offline mode, leave `VITE_API_URL` blank and set `VITE_DEMO_MODE=true` to use existing browser seed data; the backend itself requires MongoDB to run. The current `Auth.jsx` stores the short-lived access token in session storage and sends it as a bearer token. The backend sends the refresh token in an HTTP-only cookie. `CLIENT_ORIGIN` must match the Vite URL exactly, including port.

The React `App.jsx` currently prefers API reads but retains its local demo copy when requests fail. **Do not mistake these local updates for server-confirmed approvals or payments.** For live deployment, change its optimistic writes to await the API response, display server errors, then invalidate/reload the collection. Use dedicated financial verification endpoints, not a browser-only `Recorded` rent status.

## API base: `/api/v1`

### Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Public client sign-up only (`name,email,password`) |
| POST | `/auth/login` | Returns `{user,accessToken}` and refresh cookie |
| POST | `/auth/refresh` | Rotates refresh cookie; returns `{user,accessToken}` |
| POST | `/auth/logout` | Removes refresh session |
| GET | `/auth/me` | Current profile |
| PATCH | `/auth/me` | Allowed profile fields / admin specialties |

Send `Authorization: Bearer <accessToken>` on protected API calls. Login/refresh responses follow the shape expected by the supplied `Auth.jsx`. For login use a password of at least 8 characters; new registrations require 10 or more.

### Collection endpoints compatible with current App.jsx

`GET /:collection` → `{items:[...],count,limit}`

`GET /:collection/:id` → `{data:{...}}`

`POST /:collection` → `{data:{...}}`

`PATCH /:collection/:id` → `{data:{...}}`

Supported: `projects`, `users`, `properties`, `tenants`, `rentPayments`, `transactions`, `listings`, `bids`, `deliverables`, `documents`, `messages`, `notifications`, `tenders`, `settings`, `audit`. Read endpoints filter records by role and relationship; most writes are restricted. `users` and `audit` do not accept generic POST. Some PATCH fields are intentionally forbidden (especially finance, status, authentication). Collection reads are currently capped at 1,000 records and need cursor pagination when scaling.

Public listings are available at `GET /marketplace/listings` and `GET /marketplace/listings/:id` (published records only). The current public React marketplace uses `/listings` and will need a small adapter to call the public route if it is to function without sign-in against a live API.

### Purpose-built, server-controlled workflows

| Method | Path | Role / action |
|---|---|---|
| POST | `/projects/:id/decision` | Super admin, `{decision:"Approved"\|"Rejected",reason}` |
| POST | `/projects/:id/assignments` | Super admin, `{adminId,responsibility}` |
| DELETE | `/projects/:id/assignments/:adminId` | Super admin; optional `?responsibility=...` |
| PATCH | `/users/:id/role` | Super admin, `{role:"admin"\|"client"\|"contractor"\|"tenant"}` |
| PATCH | `/users/:id/state` | Super admin, `{active:true\|false}` |
| POST | `/tenants/:id/removal-request` | Assigned admin, `{reason}` |
| POST | `/tenants/:id/removal-decision` | Super admin, `{decision:"remove"\|"reinstate"}` |
| POST | `/rent-payments/:id/verify` | Super admin, `{evidence:"bank statement or receipt review reference"}` |
| POST | `/rent-payments/:id/reverse` | Super admin, `{reason}` |
| GET | `/tenants/:id/statement?asOf=YYYY-MM-DD` | Tenant themselves or authorised property manager/owner |
| GET | `/properties/:id/statement?asOf=YYYY-MM-DD` | Owner, property admin, or super admin |
| GET | `/dashboard` | Per-user metrics and property/tenant statements |
| GET | `/health` | Database health |

Example project decision after obtaining access token:

```bash
curl -X POST http://localhost:5000/api/v1/projects/PRJ-123/decision \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"decision":"Approved","reason":"Documents reviewed"}'
```

The App.jsx legacy `PATCH /projects/:id` for approvals and assignments, and `PATCH /users/:id` for role conversion, are also recognised for compatibility, but server validation and permission checks are enforced.

## Core workflow

1. Client registers and submits a project → `Under review`, `approvalStatus=Pending`.
2. Super admin reviews and approves/rejects. Rejected projects are not assignable.
3. Super admin promotes user to admin. The conversion invalidates old tokens and the new admin completes their specialty profile.
4. Super admin assigns one or multiple admins to a project, possibly with different responsibilities. An admin can be assigned to many projects.
5. Super admin registers a property against an approved project; the owner's ID and admin IDs derive from that project.
6. Super admin converts an existing account to tenant, or provisions a user through a later invitation flow; property staff link the tenant and occupied unit.
7. Staff submit a rent receipt with a unique payment reference. It is `Pending` and does not count as received until separately verified by the super admin.
8. Tenant/owner/authorised admin sees server-generated statements. Super admin may reverse an incorrectly confirmed payment.
9. Assigned admin requests tenant removal. Super admin decides removal/reinstatement. History remains intact.

## Production integration still required

This is a substantial functional API foundation, **not a deploy-and-forget live financial system**. Before handling real funds or personal data, arrange an independent security review, add end-to-end integration tests against a real test MongoDB, configure TLS/domain and trusted proxies, enforce CSRF/origin protections for cookie operations, add API abuse protection and monitoring, backups/restore drills, transaction-level accounting with invoices/lease terms and partial/prorated rent, secure document uploads and access policy, email/tenant invitation & password reset/2FA, regulatory/privacy policies, idempotency keys and authenticated **M-Pesa/bank webhooks**, reconciliations and separate approval for owner payouts. **No live payment transfer, bank/M-Pesa webhook, SMS, email, KYC or money movement is implemented.**

The service deliberately treats manual receipts as `Pending` until explicitly verified; the frontend's local demo currently labels them `Recorded` immediately. For live use, update frontend to await server confirmation and display payment states correctly. Similarly, tenant 'permanent removal' uses soft-deactivation to keep an auditable rent history.

## Project layout

```
src/
  app.js                   Express app and middleware
  server.js                DB and HTTP server startup
  config.js                Environment configuration
  models/index.js          All Mongoose schemas
  routes/auth.js           Login, refresh, registration, profile
  routes/operations.js     Approval, assignment, tenant, ledger workflows
  routes/collections.js    Role-scoped generic UI collection compatibility
  routes/public.js         Public published listings
  middleware/auth.js       Bearer JWT and roles
  services/permissions.js  Ownership/allocation checks
  services/ledger.js       Deterministic financial statements
  services/audit.js        Server audit trail
  utils/http.js            Validation and safe responses
scripts/seed.js            Bootstrap super admin and optional dev demo
scripts/check.js           JS syntax check
tests/ledger.test.js        Ledger unit tests
```
