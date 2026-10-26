import { LocalRepository } from './local/local-repository';
import { loadDemoAssetsFromBundle } from '@/assets/demo';
import type { Repository } from './repository';

/**
 * The app always talks to a Repository. Today the local backend is wired;
 * the Supabase backend lives in src/data/supabase and is selected when
 * VITE_BACKEND=supabase with credentials present. Keeping the factory here
 * means no component ever imports a concrete backend.
 */
let singleton: Repository | null = null;

export async function createRepository(): Promise<Repository> {
  if (singleton) return singleton;
  const env = import.meta.env;
  const wantsSupabase = env.VITE_BACKEND === 'supabase';
  const hasCredentials = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
  if (wantsSupabase && hasCredentials) {
    // Loaded on demand so the local demo never ships the Supabase client.
    const { createSupabaseRepository } = await import('./supabase/supabase-repository');
    singleton = createSupabaseRepository({
      url: env.VITE_SUPABASE_URL as string,
      anonKey: env.VITE_SUPABASE_ANON_KEY as string,
    });
    return singleton;
  }
  singleton = new LocalRepository({ assetLoader: loadDemoAssetsFromBundle });
  return singleton;
}

export function backendNotice(): string | null {
  const env = import.meta.env;
  if (env.VITE_BACKEND === 'supabase' && !(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY)) {
    return '已选择 Supabase 后端，但未提供 VITE_SUPABASE_URL / ANON_KEY，当前回退为本地演示数据。';
  }
  return null;
}
