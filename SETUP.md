# Rondor Excavations — Field App Setup

## Option A — Demo (zero setup, 1 minute)

> **Open `index.html` as-is, or deploy this folder to Netlify as-is — no setup needed.**

The app runs entirely in the browser (localStorage) with two demo accounts:

| Username | Password | Role | Sees |
|---|---|---|---|
| `admin` | `admin` | Owner | Everything: estimator, quotes, jobs, costing, photos, prices, team |
| `user` | `user` | Field worker | Assigned jobs only — **name + address, zero financials** — plus photo upload |

The demo is pre-seeded with one sample client (Sarah Johnson), two sample
quotes (`R-2026-0001` draft, `R-2026-0002` sent), one active job assigned to
the worker account, and one pending change order — so every screen has
something to show. Try the full loop: log in as `admin`, open the sent quote,
copy the customer accept link, open it in another tab, accept it as the
customer, then log in as `user` and upload a photo to the job.

To reset the demo, clear the site's localStorage (or use a private window).

---

## Option B — Go live (Supabase backend, ~20 minutes)

The Supabase schema, security policies, and all app wiring are already built.
You only need to create the project and paste two keys.

### 1. Create a free Supabase project
1. Go to https://supabase.com → **Start your project** → sign up/in.
2. **New project** → name it `rondor-field-app`, pick a region near you
   (e.g. US/Canada), set a database password (save it somewhere safe).
3. Wait ~2 minutes for provisioning.

### 2. Run the schema
1. In Supabase: **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this folder, copy the whole file, paste,
   press **Run**. It creates all tables, Row Level Security policies, storage
   buckets, the quote-numbering function, and the customer token functions.
3. Confirm no errors in the results panel.

### 3. Lock down auth (no public signup)
1. **Authentication → Settings** (or Providers/Email settings):
   - Turn **OFF** "Enable new user signups" (or "Allow new users to sign up").
   - Make sure **Email** provider is **ON** (needed for password resets).
2. **Authentication → Users** → **Add user** → create the owner's account
   (their real email + a temporary password). They'll change it after login.
   - Do the same for each field worker.
3. In the app (as owner): **More → Team & roles** → set each account to
   `owner` or `worker`. New accounts default to `worker` (least privilege).

### 4. Paste the keys into `config.js`
1. In Supabase: **Project Settings → API** → copy the **Project URL** and the
   **anon public** key.
2. Edit `config.js` in this folder:
   ```js
   window.RONDOR_CONFIG = {
     DEMO_MODE: false,
     SUPABASE_URL: "https://xyzcompany.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi..."
   };
   ```
   Never publish these to a public repo — but they are the *public* anon key
   (safe in the browser); the database is protected by Row Level Security.

### 5. Deploy to Netlify
- **Drag-and-drop:** https://app.netlify.com/drop — drag this whole folder.
- **Or CLI:** `npm i -g netlify-cli && netlify deploy --prod --dir=.`
- The site gets HTTPS automatically. Open it on the crew's phones and
  **Add to Home Screen** for an app-like experience.

### 6. First run
1. Log in with the owner account created in step 3.
2. **More → Price list** — rates are pre-seeded from the 2026 workbook; adjust
   any that changed and save (one central list, every estimate uses it).
3. Create a test estimate → save as quote → send yourself the customer link
   to see the accept flow.

---

## What the security model guarantees

- **Workers** can only ever read job `id`, `name`, `address`, `status` — via a
  database function that returns exactly those four columns. They have *no*
  access to the jobs table itself, and no access to quotes, customers,
  change orders, or actuals. They can upload photos only to jobs assigned to
  them (enforced in the database *and* in storage policies).
- **Customers** never log in. They get an unguessable link (`accept.html?t=…`)
  that shows only the customer version of the quote (one line per section,
  T&Cs, total) and lets them accept with a typed name + timestamp.
- **Owners** see everything. Password recovery is Supabase's built-in
  reset-email flow (Login → *Forgot password?*).
- Every photo is **date-stamped and GPS-stamped**: the app burns
  `YYYY-MM-DD HH:MM · lat, lng` visibly onto the image *and* stores the
  timestamp + coordinates in the database. Uploads are blocked until the
  device provides a location fix.

## Feature notes / honest simplifications (v1)

- **Frozen PDF snapshot:** the app stores a frozen, branded HTML snapshot of
  each quote (the customer version, immutable even if prices later change).
  The **Print / PDF** button opens it for browser print-to-PDF. A true
  server-rendered PDF is a phase-2 item.
- **QuickBooks:** v1 exports accepted quotes as a CSV in a QuickBooks-import
  friendly format. Full two-way API sync is phase 2.
- **Offline:** estimator drafts autosave locally; photo uploads queue in
  IndexedDB when offline and upload automatically on reconnect (or via
  **Sync now**). The app shell itself loads from Netlify's CDN cache after
  the first visit.
- **Estimating logic** replicates the 2026 workbook exactly: 8% material
  markup (services unmarked), per-job O&P (copper/WWS/LDS 12%, watermain 15%,
  abandonments 10%, catchbasins 10%, manholes 15%, admin permits 10%),
  25% frost surcharge for work Dec 1–Mar 31, lane closure per-day =
  width × rate (**rate basis to be confirmed**), catchbasin/manhole sand
  unmarked per the workbook (flagged open question).

## File map

```
index.html            the app
accept.html           customer magic-link page (quote accept / change-order approve)
config.js             DEMO_MODE flag + Supabase keys
netlify.toml          deploy + security headers
assets/logo.png       Rondor logo
assets/style.css      mobile-first styles
assets/data.js        generated from the 2026 workbook: 72 prices, 7 job types, 13 T&Cs
assets/calc.js        pure estimating math (mirrors the workbook)
assets/store.js       data layer: DemoStore (localStorage) + LiveStore (Supabase)
assets/app.js         the whole UI
supabase/schema.sql   tables, RLS, storage, token functions (validated: 57 statements)
SETUP.md              this file
```
