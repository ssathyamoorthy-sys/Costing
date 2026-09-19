# Terry Towel Costing - Adwaith Lakshmi Industries

Web app that replaces the Price Working / Costing module framework spreadsheets:
raw material rate management, product/customer/general masters, a merchandiser
quote builder with live costing, and a supervisor approval workflow that
produces a customer-ready PDF/Excel quotation.

## Stack

- **Backend**: Node.js + Express + TypeScript + Prisma + SQLite (`backend/`)
- **Frontend**: React + TypeScript + Vite (`frontend/`)
- Designed to run as a **single Node process** in production (the backend
  serves the built frontend), backed by a single SQLite file - no separate
  database server to install or manage.

## First-time setup

```bash
cd backend
npm install
npx prisma migrate deploy   # creates/updates dev.db
npx tsx prisma/seed.ts      # seeds 4 users + starter masters - CHANGE PASSWORDS AFTER
cd ../frontend
npm install
```

Seeded users (username / password, all `ChangeMe123!`): `admin`, `supervisor`,
`purchase`, `merchandiser`. Change every password after first login - there's
no UI for that yet, so for now update `backend/prisma/seed.ts` or add a
"change password" endpoint before going live.

## Local development

Two terminals:

```bash
cd backend && npm run dev     # API on http://localhost:4000, auto-reloads
cd frontend && npm run dev    # UI on http://localhost:5173, proxies /api to :4000
```

## Production deployment (single process, on your own server)

```bash
cd backend && npm run build          # compiles to backend/dist
cd ../frontend && npm run build      # builds to frontend/dist
cd ../backend
NODE_ENV=production PORT=4000 node dist/server.js
```

The backend detects `frontend/dist` and serves the whole app (API + UI) on
one port - point your reverse proxy (nginx/IIS) or firewall at that port and
you're done. No separate frontend server needed.

**Before going live**, set real values in `backend/.env`:

- `JWT_SECRET` - change from the placeholder
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` - for
  email notifications (price overrides, rate approvals, quote status changes).
  Until these are set, notifications still appear in-app but emails are
  silently skipped (logged to the server console).
- `DATABASE_URL` - defaults to a local `dev.db` file; point it at wherever you
  want the SQLite file to live on the server (back this file up regularly -
  it's the entire database).

## What's implemented

- **Raw Material Master**: Purchase submits a rate + validity window,
  Supervisor approves/rejects. Expired rates fall back to the last approved
  price with a warning rather than blocking costing. Supervisor can also
  override a material's price for one specific quote line, which notifies
  Purchase (in-app + email).
- **Product/Quality Master**: process parameters (weaving wastage, velour
  charges/loss, weight loss, transport, rejection), a 4-slot yarn recipe with
  mixing-% validation (warns if it doesn't total 100%), and default
  accessory costs per piece (overridable per quote line).
- **Customer Master**: payment/freight terms, W.C./LC interest, margin,
  commission.
- **General Mapping**: currency exchange rates (INR/USD/GBP/EUR, updated
  weekly), export freight rate, and per-item-type stitching/packing cost
  (Bath Towel, Hand Towel, Bath Sheet, Face Towel, Bathrobe).
- **Costing engine** (`backend/src/costing/engine.ts`): a direct port of the
  BOM waste-compounding chain and cost stack from `Price Working .xlsx`,
  unit-tested against the workbook's own cached values.
- **Quotes**: multi-line, multi-currency, full cost breakup per line,
  Draft -> Pending Approval -> Approved/Rejected -> Sent -> Won/Lost workflow,
  PDF and Excel export with the company letterhead.
- **xlsx import/export** for Raw Materials, Products, and Customers, for
  bulk onboarding of existing spreadsheet data and for backups.

## Known gaps / next steps

- Reverse-import of a legacy `Price Working.xlsx`-style file to auto-create a
  Product master entry (deferred per discussion - forward export/import of
  the app's own templates is done, this is the harder reverse direction).
- The CIF/freight container-fill factor and the market-benchmark comparison
  cells seen on the original Summary sheet were flagged as "resolve later"
  and are not modeled yet.
- No password-change UI yet - change the seeded passwords via a direct DB
  update or add that screen before go-live.
- Mobile app - the web UI is usable on a phone browser today; a native/PWA
  wrapper reusing this same backend API is the planned next phase once the
  web app is validated in daily use.
