import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseRepositoryOptions {
  url: string;
  anonKey: string;
  /**
   * Optional auth storage key. The app uses the Supabase default; tests pass a
   * unique key per repository so several real users can be signed in at once
   * in one browser context without overwriting each other's session.
   */
  storageKey?: string;
  /** Defaults to true. Tests may keep persistence but use an isolated key. */
  persistSession?: boolean;
}

/** Creates the single supabase-js client used by the repository. */
export function createSupabaseClient(options: SupabaseRepositoryOptions): SupabaseClient {
  const url = options.url.replace(/\/+$/, '');
  return createClient(url, options.anonKey, {
    auth: {
      persistSession: options.persistSession ?? true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      ...(options.storageKey ? { storageKey: options.storageKey } : {}),
    },
  });
}
