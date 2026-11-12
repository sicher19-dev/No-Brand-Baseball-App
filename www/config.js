/* No Brand Baseball backend settings.
   Fill these in from Supabase -> Project Settings -> API (Project URL and the "anon public" key).
   The anon key is safe to ship in the app; row-level security in supabase/schema.sql does the protecting.
   Leave both empty and the app runs reports-only (assessments and messages show "not enabled"). */
window.NBB_CONFIG = {
  supabaseUrl: "https://qmsjapplovtvkxxkbdmw.supabase.co",
  supabaseAnonKey: "",
  maxVideoMB: 50,               // Free plan limit. On Pro: raise Storage -> Settings, set 500 here and in supabase/schema.sql
  coachLabel: "Brian & Derek",
  coachInbox: "nobrandbaseball@gmail.com"
};
