// Entry point for the vendored Supabase bundle.
// Bundled to lib/vendor/supabase.js by `npm run build:vendor` (esbuild, IIFE,
// global-name=supabase) so the MV3 service worker can load it via importScripts
// without a runtime bundler and without remote code (CSP-safe).
//
// We export only createClient; the extension uses Auth + PostgREST (REST) and
// never opens a Realtime channel.
export { createClient } from '@supabase/supabase-js';
