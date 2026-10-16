(function () {
  // Do not overwrite an existing runtime config if the server or another script provided it.
  window.KHAN_FF_CONFIG = window.KHAN_FF_CONFIG || {};

  if (!window.KHAN_FF_CONFIG.supabaseUrl) {
    window.KHAN_FF_CONFIG.supabaseUrl = "https://sttgdalmnpkljjcbqmfs.supabase.co";
  }

  if (!window.KHAN_FF_CONFIG.supabaseAnonKey) {
    window.KHAN_FF_CONFIG.supabaseAnonKey = "sb_publishable_jnlyt5dfqrv41_rL9K9RRA_v6sL2IHk";
  }

  // Keep the file idempotent and simple: it only ensures the global exists with publishable values.
})();
