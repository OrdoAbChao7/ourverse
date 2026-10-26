import { AppError } from '../errors';
import type { AskSource } from './retrieval';

/**
 * Optional model layer. The model only ever receives the sources that the
 * retrieval layer already authorised for this viewer — never the whole memory
 * base, never private rows belonging to the other person.
 */
export interface ModelSourcePayload {
  id: string;
  title: string;
  occurredOn: string;
  occurredTime: string | null;
  authorName: string;
  excerpt: string;
}

export interface AskModelRequest {
  question: string;
  sources: ModelSourcePayload[];
  locale: 'zh-CN';
  spaceName: string;
}

export interface AskModelResult {
  answerMd: string;
  citedMemoryIds: string[];
  modelId?: string;
}

export interface AskModel {
  readonly id: string;
  ask(request: AskModelRequest, signal?: AbortSignal): Promise<AskModelResult>;
}

export class AskModelError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('NETWORK', message, options);
    this.name = 'AskModelError';
  }
}

export function toModelSources(sources: AskSource[]): ModelSourcePayload[] {
  return sources.map((source) => ({
    id: source.memoryId,
    title: source.title,
    occurredOn: source.occurredOn,
    occurredTime: source.occurredTime,
    authorName: source.authorName,
    excerpt: source.excerpt,
  }));
}

export function assertValidModelResult(result: AskModelResult, sources: ModelSourcePayload[]): void {
  const answer = result.answerMd?.trim();
  if (!answer) throw new AskModelError('记忆助手返回了空内容，请重试。');
  if (answer.length > 6000) throw new AskModelError('记忆助手返回内容过长，已丢弃。');

  const allowed = new Set(sources.map((source) => source.id));
  const cited = result.citedMemoryIds ?? [];
  if (cited.length === 0) {
    throw new AskModelError('记忆助手没有给出引用来源，答案已被丢弃。');
  }
  for (const id of cited) {
    if (!allowed.has(id)) {
      throw new AskModelError('记忆助手引用了未授权的记录，答案已被丢弃。');
    }
  }

  const markers = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  for (const marker of markers) {
    if (!Number.isInteger(marker) || marker < 1 || marker > sources.length) {
      throw new AskModelError('记忆助手引用了不存在的来源编号，答案已被丢弃。');
    }
  }
  if (markers.length === 0) {
    throw new AskModelError('记忆助手的答案没有标注来源，答案已被丢弃。');
  }
}

export async function runModel(
  model: AskModel,
  request: AskModelRequest,
  options: { timeoutMs?: number } = {},
): Promise<AskModelResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      model.ask(request, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AskModelError('记忆助手响应超时，已回到检索模式。'));
        }, timeoutMs);
      }),
    ]);
    assertValidModelResult(result, request.sources);
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AskModelError('记忆助手暂时不可用，已回到检索模式。', { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Deterministic local adapter used when no provider is configured and in tests. */
export class FakeAskModel implements AskModel {
  readonly id: string;
  private readonly handler: (request: AskModelRequest) => Promise<AskModelResult> | AskModelResult;

  constructor(handler: (request: AskModelRequest) => Promise<AskModelResult> | AskModelResult) {
    this.id = 'fake-model';
    this.handler = handler;
  }

  async ask(request: AskModelRequest): Promise<AskModelResult> {
    return this.handler(request);
  }
}
