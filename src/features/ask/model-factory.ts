import type { AskModel } from '@/domain/ask/model';
import type { Repository } from '@/data/repository';
import { RemoteAskModel } from './remote-model';

/**
 * Returns a model adapter only when the deployment is explicitly configured.
 * Without one the assistant stays fully functional in retrieval mode.
 */
export function getConfiguredModel(repo: Repository): { model: AskModel | null; reason: string | null } {
  const proxyEnabled = import.meta.env.VITE_AI_PROXY_ENABLED === 'true';
  if (repo.kind !== 'supabase') {
    return { model: null, reason: '演示后端没有连接模型服务，当前仅使用检索模式。' };
  }
  if (!proxyEnabled) {
    return { model: null, reason: '模型代理未启用（VITE_AI_PROXY_ENABLED 未设置）。' };
  }
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { model: null, reason: '模型代理需要 Supabase 地址与 anon key。' };
  }
  return {
    model: new RemoteAskModel({ url, anonKey }),
    reason: '模型回答是否可用取决于服务端 ai-ask 函数是否配置了提供商密钥。',
  };
}
