/* DEPRECATED: supabase/config/config.js
   This file was superseded by js/supabase/config/config.js and is kept only as a deprecated
   shim to avoid breaking references. Do not edit — update pages to load the canonical file.
*/
(function () {
  console.warn('Deprecated Supabase config path "supabase/config/config.js" loaded. Use "js/supabase/config/config.js" instead.');
  // Migrate existing values safely if present. Do not overwrite values already set by the canonical loader.
  window.KHAN_FF_CONFIG = window.KHAN_FF_CONFIG || {};

  // Preserve any existing values from the old file if the canonical file hasn't set them yet.
  if (!window.KHAN_FF_CONFIG.supabaseUrl) {
    window.KHAN_FF_CONFIG.supabaseUrl = "https://sttgdalmnpkljjcbqmfs.supabase.co";
  }
  if (!window.KHAN_FF_CONFIG.supabaseAnonKey) {
    window.KHAN_FF_CONFIG.supabaseAnonKey = "sb_publishable_jnlyt5dfqrv41_rL9K9RRA_v6sL2IHk";
  }
})();
