# Inventory Tracker (multi-org)

Rebuild of the offline-only Dexie inventory PWA. Supabase is now the source of truth, and it supports multiple organizations.

**Stack:** Vite, React 19, react-router 7, Tailwind 4, vite-plugin-pwa, ZXing scanning, SheetJS XLSX export, CSV import, supabase-js with magic-link auth, and Dexie 4 as an offline cache plus mutation outbox.

## Setup
1. Create a Supabase project.
2. Apply `supabase/migrations/*.sql`, using `supabase db push` or the SQL editor.
3. In Auth → URL Configuration, set Site URL and Redirect URLs to your deploy URL and to `http://localhost:5173`.
4. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. `npm install && npm run dev`. Use `npm run build` for production; the output goes to `dist/`, a static SPA, so rewrite all routes to `/index.html`.

## How it works
- **Orgs:** `organizations` and `org_members` with roles owner/admin/member. RLS restricts every row to members of its org. Owners and admins invite people by email (`org_invites`), and an invite is accepted automatically the next time that person signs in.
- **Offline:** All edits are applied to Dexie immediately and queued in an outbox. The outbox flushes on reconnect, at startup, and every 30s. Quantity changes go through the `adjust_quantity` RPC as deltas, so concurrent edits on two phones don't overwrite each other. Realtime changes trigger a re-pull.
- **Legacy data:** Import → "Load old app data" reads the old `inventoryDB` from the same browser and upserts it into the current org by barcode.
