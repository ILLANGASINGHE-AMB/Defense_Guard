# Defense_Guard

Defense Guard Mobile Track Web App (DGSS Live Tracking Supervisor Dashboard).

Live map and daily track replay dashboard for supervisor monitoring of guards on duty and checkpoint scans.

## Features

- **Live Guard Tracking**: Real-time map displaying guard locations, duty statuses (Reporting now, Delayed, Offline), and battery levels.
- **Checkpoint Scans**: View checkpoint logs and flagged suspicious scans.
- **Historical Track Replay**: Select a date and view a guard's movement path.
- **Supabase Integration**: Real-time database sync and Row Level Security (RLS) authentication.

## Setup & Configuration

1. Copy or edit `config.js`:
   ```javascript
   window.DGSS_CONFIG = {
     SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
     SUPABASE_ANON_KEY: "YOUR_ANON_KEY",
     FRESH_SECONDS: 150,
     STALE_SECONDS: 900,
     DEFAULT_CENTER: [6.9271, 79.8612],
     DEFAULT_ZOOM: 12
   };
   ```
2. Replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your Supabase project API credentials.

## Running Locally

Serve statically with any local HTTP server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Deployment

Deploy directly to any static web host:
- GitHub Pages
- Cloudflare Pages
- Vercel / Netlify
