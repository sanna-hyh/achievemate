import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { url: rawUrl, anonKey } = window.ACHIEVEMATE_SUPABASE;

// Project URL only — not the REST endpoint (no /rest/v1 suffix).
const url = String(rawUrl || "")
  .trim()
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,        // survives reloads via localStorage
    autoRefreshToken: true,
    detectSessionInUrl: true,    // handles email-confirmation redirects
    flowType: "pkce",
  },
});

// Expose for the existing non-module scripts (app.js etc. are
// classic scripts; they reach the client through window).
window.AchieveMateSupabase = supabase;
