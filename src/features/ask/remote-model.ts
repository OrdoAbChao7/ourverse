import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AskModelError,
  type AskModel,
  type AskModelRequest,
  type AskModelResult,
} from '@/domain/ask/model';

export interface RemoteAskModelOptions {
  url: string;
  anonKey: string;
  /** Edge function name; defaults to the repository's `ai-ask`. */
  functionName?: string;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * Calls the `ai-ask` Edge Function with the signed-in user's access token.
 * The function re-fetches every source through RLS before prompting, so the
 * browser is not trusted with visibility. Prompt and answer bodies are never
 * logged here.
 */
export class RemoteAskModel implements AskModel {
  readonly id = 'supabase-ai-ask';

  private readonly url: string;
  private readonly anonKey: string;
  private readonly functionName: string;
  private readonly client: SupabaseClient;

  constructor(options: RemoteAskModelOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.anonKey = options.anonKey;
    this.functionName = options.functionName ?? 'ai-ask';
    this.client = createClient(this.url, options.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }

  async ask(request: AskModelRequest, signal?: AbortSignal): Promise<AskModelResult> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw new AskModelError('无法确认登录状态，请重新登录。', { cause: error });
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new AskModelError('请先登录后再使用记忆助手。');

    let response: Response;
    try {
      response = await fetch(`${this.url}/functions/v1/${this.functionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          question: request.question,
          sources: request.sources,
          spaceName: request.spaceName,
        }),
        signal,
      });
    } catch (fetchError) {
      if (isAbortError(fetchError)) throw fetchError;
      throw new AskModelError('网络连接失败，请稍后重试。', { cause: fetchError });
    }

    if (!response.ok) {
      throw new AskModelError(await this.errorMessage(response));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AskModelError('记忆助手返回了无法解析的内容。');
    }

    const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const answerMd = typeof record.answerMd === 'string' ? record.answerMd : '';
    const citedMemoryIds = Array.isArray(record.citedMemoryIds)
      ? record.citedMemoryIds.filter((id): id is string => typeof id === 'string')
      : [];

    if (!answerMd.trim()) throw new AskModelError('记忆助手返回了空内容，请重试。');
    return { answerMd, citedMemoryIds };
  }

  private async errorMessage(response: Response): Promise<string> {
    try {
      const payload: unknown = await response.json();
      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        const serverMessage = record.message ?? record.error ?? record.code;
        if (typeof serverMessage === 'string' && serverMessage.trim()) {
          return serverMessage.trim();
        }
      }
    } catch {
      // The body was not JSON; fall through to a status-based message.
    }
    return `记忆助手暂时不可用（HTTP ${response.status}）。`;
  }
}
