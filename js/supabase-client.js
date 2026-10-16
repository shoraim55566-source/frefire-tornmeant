const config = window.KHAN_FF_CONFIG || {};
const safeUrl = typeof config.supabaseUrl === 'string' ? config.supabaseUrl.trim() : '';
const safeKey = typeof config.supabaseAnonKey === 'string' ? config.supabaseAnonKey.trim() : '';

export const supabaseConfig = {
  url: safeUrl,
  anonKey: safeKey,
  ready: Boolean(safeUrl && safeKey),
};

export function ensureSupabaseClient() {
  if (!supabaseConfig.ready) {
    console.warn('Supabase configuration missing. Add your project URL and publishable key in config/config.js.');
    return null;
  }

  if (!window.__KHAN_FF_SUPABASE__) {
    const { createClient } = window.supabase;
    if (!createClient) {
      throw new Error('Supabase JavaScript SDK failed to load. Check the CDN script tag in index.html.');
    }
    window.__KHAN_FF_SUPABASE__ = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return window.__KHAN_FF_SUPABASE__;
}

export const supabase = ensureSupabaseClient();
