// ---------------------------------------------------------------------------
// DGSS dashboard configuration.
// Fill these in from Supabase: Project Settings > API.
// The anon key is safe to expose. Row Level Security is what protects the data,
// which is why only admins can read other guards' positions.
// Never put the service_role key in this file.
// ---------------------------------------------------------------------------
window.DGSS_CONFIG = {
  SUPABASE_URL: "https://lbjidikkfofhhubqvwje.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiamlkaWtrZm9maGh1YnF2d2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNTMyMDgsImV4cCI6MjEwNDYyOTIwOH0.XhDuYGWCmoZUAZYffNdJ-5SQVlqt4ogaotZPiZ8Gq5s",

  // A guard is treated as live if their last fix is newer than this.
  FRESH_SECONDS: 150,
  // Older than this and they are treated as offline.
  STALE_SECONDS: 900,
  // Map centre used before any guard has reported.
  DEFAULT_CENTER: [6.9271, 79.8612],
  DEFAULT_ZOOM: 12
};
