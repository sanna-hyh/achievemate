import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { url: rawUrl, anonKey } = window.ACHIEVEMATE_SUPABASE;

// Project URL only — not the REST endpoint (no /rest/v1 suffix).
const url = String(rawUrl || "")
  .trim()
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,        // keep users signed in across visits (sb-* keys)
    autoRefreshToken: true,      // refresh before the access token expires
    detectSessionInUrl: true,    // handles email-confirmation redirects
    flowType: "pkce",
  },
});

export function describeSupabaseOutage(error) {
  const message = String(error?.message || error || "").toLowerCase();

  if (message.includes("paused") || message.includes("503")) {
    return "Supabase project is paused — open supabase.com/dashboard and click Restore project.";
  }

  if (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("name not resolved")
  ) {
    return "Cannot reach Supabase — your free project may be paused or removed. Restore it at supabase.com/dashboard.";
  }

  return "Couldn't reach the server — working offline";
}

// Expose for the existing non-module scripts (app.js etc. are
// classic scripts; they reach the client through window).
window.AchieveMateSupabase = supabase;
