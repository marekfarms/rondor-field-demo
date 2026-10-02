/* Rondor Excavations field app — Supabase config.
 *
 * LOCAL MODE (zero setup): leave DEMO_MODE true (or leave the keys as
 * placeholders) and the app runs entirely in the browser on localStorage,
 * with accounts  admin/admin  (owner) and  user/user  (worker).
 * Open index.html as-is or deploy the folder to Netlify — no setup needed.
 *
 * GOING LIVE: set DEMO_MODE to false and paste real values from your
 * Supabase project (see SETUP.md). The schema and all backend wiring are
 * already in place; the same UI switches to the live database.
 */
window.RONDOR_CONFIG = {
  DEMO_MODE: true,
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY"
};
