// ---------------------------------------------------------------------------
// DGSS dashboard configuration.
// Fill these in from Supabase: Project Settings > API.
// The anon key is safe to expose. Row Level Security is what protects the data,
// which is why only admins can read other guards' positions.
// Never put the service_role key in this file.
// ---------------------------------------------------------------------------
window.DGSS_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_KEY",

  // A guard is treated as live if their last fix is newer than this.
  FRESH_SECONDS: 150,
  // Older than this and they are treated as offline.
  STALE_SECONDS: 900,
  // Map centre used before any guard has reported.
  DEFAULT_CENTER: [6.9271, 79.8612],
  DEFAULT_ZOOM: 12
};
