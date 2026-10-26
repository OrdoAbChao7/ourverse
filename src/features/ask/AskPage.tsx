import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { useRepository } from '@/app/RepositoryContext';
import { useAsync } from '@/app/useAsync';
import { useDocumentTitle } from '@/app/useNow';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Controls';
import { Badge, ErrorNotice, LoadingState, PageHeader } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { Markdown } from '@/lib/markdown';
import { composeRetrievalAnswer, type AskAnswer } from '@/domain/ask/answer';
import { retrieveSources } from '@/domain/ask/retrieval';
import { runModel, toModelSources } from '@/domain/ask/model';
import { askQuestionSchema } from '@/domain/schemas';
import { errorMessage } from '@/domain/errors';
import { formatDate } from '@/lib/date';
import {
  IconChevronRight,
  IconLock,
  IconSearch,
  IconShield,
  IconSparkles,
} from '@/components/icons';
import { VisibilityBadge } from '@/features/memories/MemoryCard';
import { getConfiguredModel } from './model-factory';

const SUGGESTIONS = [
  '我们第一次看海是什么时候？',
  '最近一次旅行去了哪里？',
  '我们一共有多少条记忆？',
  '去年三月有什么记录？',
  '厨房里发生过什么？',
];

export function AskPage() {
  useDocumentTitle('记忆助手');
  const repo = useRepository();
  const { session } = useAuth();
  const { toast } = useToast();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const data = useAsync(async () => {
    const [memories, preference, now, space] = await Promise.all([
      repo.listMemories(),
      repo.getAiPreference(),
      repo.now(),
      repo.getCurrentSpace(),
    ]);
    return { memories, preference, now, space };
  }, []);

  const configured = useMemo(() => getConfiguredModel(repo), [repo]);
  const aiEnabled = Boolean(data.data?.preference.enabled);
  const modelActive = aiEnabled && configured.model !== null;

  if (data.loading && !data.data) return <LoadingState label="正在整理记忆索引…" />;
  if (data.error) {
    return <ErrorNotice message={errorMessage(data.error, '无法读取记忆索引。')} onRetry={data.reload} />;
  }

  const { memories, preference, space } = data.data ?? {
    memories: [],
    preference: { enabled: false, consentAt: null },
    now: new Date(),
    space: null,
  };
  const viewer = { userId: session?.user.id ?? null, isMemberOfSpace: Boolean(session?.space) };

  async function ask(rawQuestion: string) {
    const parsed = askQuestionSchema.safeParse(rawQuestion);
    if (!parsed.success) {
      setAskError(parsed.error.issues[0]?.message ?? '问题太短了。');
      return;
    }
    setAsking(true);
    setAskError(null);
    setQuestion(parsed.data);
    try {
      const now = await repo.now();
      const outcome = retrieveSources(memories, parsed.data, { viewer, now });
      let next = composeRetrievalAnswer(parsed.data, outcome, now);

      if (preference.enabled && configured.model && outcome.confidence !== 'none' && outcome.sources.length > 0) {
        try {
          const result = await runModel(configured.model, {
            question: parsed.data,
            sources: toModelSources(outcome.sources),
            locale: 'zh-CN',
            spaceName: space?.displayName ?? '我们的星球',
          });
          next = {
            ...next,
            mode: 'model',
            modelId: result.modelId ?? configured.model.id,
            answerMd: result.answerMd,
            degradedReason: null,
          };
        } catch (modelError) {
          next = { ...next, degradedReason: errorMessage(modelError, '模型暂时不可用，已回到检索模式。') };
          toast({ title: '模型不可用，已回到检索模式', description: errorMessage(modelError), tone: 'error' });
        }
      } else if (preference.enabled && !configured.model) {
        next = { ...next, degradedReason: configured.reason };
      }
      setAnswer(next);
    } catch (error) {
      setAskError(errorMessage(error, '检索失败，请稍后再试。'));
    } finally {
      setAsking(false);
    }
  }

  async function onToggleAi(next: boolean) {
    if (next) {
      setConsentOpen(true);
      return;
    }
    try {
      await repo.setAiPreference(false);
      data.reload();
      toast({ title: '已关闭 AI 外部调用', description: '记忆助手会继续以纯检索模式工作。' });
    } catch (error) {
      toast({ title: '无法修改设置', description: errorMessage(error), tone: 'error' });
    }
  }

  async function onConsent() {
    try {
      await repo.setAiPreference(true);
      setConsentOpen(false);
      data.reload();
      if (!configured.model) {
        toast({
          title: '已记录你的选择',
          description: configured.reason ?? '模型服务尚未配置，当前仍为检索模式。',
        });
      } else {
        toast({ title: '已启用模型回答', description: '只会在你提出问题时，把检索到的片段发送给模型。', tone: 'success' });
      }
    } catch (error) {
      toast({ title: '无法启用', description: errorMessage(error), tone: 'error' });
    }
  }

  function askSuggestion(text: string) {
    setQuestion(text);
    void ask(text);
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <PageHeader
        eyebrow="记忆助手"
        title="问一问你们的过去"
        description="它只会检索你有权查看的记录，并且每一个事实都带着来源编号。找不到证据时，它会直接说「暂无足够记录」，而不是编一个答案。"
        actions={
          <Badge tone={modelActive ? 'violet' : 'neutral'} dot>
            {modelActive ? '模型增强' : '仅检索模式'}
          </Badge>
        }
      />

      <div className="glass rounded-2xl p-4 sm:p-5">
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <label htmlFor="ask-question" className="sr-only">
            输入问题
          </label>
          <div className="flex items-start gap-3">
            <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet/25 bg-violet/[0.07] text-violet">
              <IconSparkles size={15} />
            </span>
            <Textarea
              id="ask-question"
              ref={inputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void ask(question);
                }
              }}
              placeholder="例如：我们第一次一起看海是什么时候？"
              className="min-h-[64px] resize-none border-0 bg-transparent px-0 py-1 text-[15px] leading-relaxed focus:bg-transparent"
              maxLength={200}
              aria-label="向记忆助手提问"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
            <p className="flex items-center gap-1.5 text-[10.5px] text-dim/80">
              <IconLock size={11} /> 只检索你有权查看的 {memories.length} 条记忆
            </p>
            <Button type="submit" variant="primary" size="sm" loading={asking} disabled={!question.trim()}>
              询问
            </Button>
          </div>
        </form>
      </div>

      {!answer && (
        <div className="space-y-3">
          <p className="label-caps text-[10px]">可以这样问</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => askSuggestion(suggestion)}
                className="rounded-full border border-white/10 bg-white/[0.025] px-3 py-1.5 text-[12px] text-mist transition-colors hover:border-violet/30 hover:text-ink"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {askError && <ErrorNotice title="没能回答" message={askError} />}

      {asking && !answer && (
        <div className="glass space-y-3 rounded-2xl p-5">
          <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.07]" />
          <div className="h-3 w-full animate-pulse rounded bg-white/[0.05]" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.05]" />
        </div>
      )}

      {answer && (
        <article className="space-y-5" aria-live="polite">
          <div className="glass rounded-2xl p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={answer.mode === 'model' ? 'violet' : 'cyan'} dot>
                  {answer.mode === 'model' ? '模型回答 · 已校验引用' : '检索结果'}
                </Badge>
                {answer.confidence === 'weak' && <Badge tone="gold">证据较弱</Badge>}
                {answer.confidence === 'none' && <Badge tone="rose">暂无证据</Badge>}
              </div>
              <p className="text-[10.5px] text-dim">
                {answer.totalMatched} 条相关记录 · {formatDate(new Date(answer.answeredAt))}
              </p>
            </div>

            {answer.degradedReason && (
              <p className="mt-3 rounded-lg border border-gold/20 bg-gold/[0.05] px-3 py-2 text-[11.5px] leading-relaxed text-[#f2e0b9]/85">
                {answer.degradedReason}
              </p>
            )}

            <div className="mt-4">
              <Markdown>{answer.answerMd}</Markdown>
            </div>

            {answer.confidence === 'none' && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-[11px] leading-relaxed text-dim">
                <IconSearch size={13} className="mt-0.5 shrink-0" />
                这个回答没有生成任何具体事实。可以换一种问法，或先补充相关记忆。
              </div>
            )}
          </div>

          {answer.sources.length > 0 && (
            <section className="space-y-2.5" aria-labelledby="sources-heading">
              <div className="flex items-center justify-between">
                <h2 id="sources-heading" className="label-caps text-[10px]">
                  来源 · 点击直达记录
                </h2>
                <span className="text-[10px] text-dim/60">编号与答案中的 [n] 对应</span>
              </div>
              <ol className="space-y-2">
                {answer.sources.map((source) => (
                  <li key={source.memoryId}>
                    <Link
                      to={`/app/memories/${source.memoryId}`}
                      className="group flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 transition-colors hover:border-white/15 hover:bg-white/[0.04]"
                    >
                      <span className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-white/10 text-[11px] text-mist">
                        {source.index}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-ink">{source.title}</span>
                          <VisibilityBadge visibility={source.visibility} />
                        </span>
                        <span className="mt-0.5 block text-[10.5px] text-dim">
                          {formatDate(source.occurredOn)}
                          {source.occurredTime ? ` · ${source.occurredTime}` : ''} · {source.authorName}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[11.5px] leading-relaxed text-mist/65">
                          {source.excerpt}
                        </span>
                      </span>
                      <IconChevronRight size={15} className="mt-1 shrink-0 text-dim transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </article>
      )}

      <section className="glass space-y-4 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-medium text-ink">模型增强回答（可选）</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              默认关闭。关闭时，助手完全在本机完成检索与回答，不发送任何内容。
            </p>
          </div>
          <Switch
            checked={aiEnabled}
            onChange={(value) => void onToggleAi(value)}
            label="启用模型增强回答"
          />
        </div>

        {aiEnabled && !configured.model && (
          <p className="rounded-lg border border-gold/20 bg-gold/[0.05] px-3 py-2 text-[11.5px] leading-relaxed text-[#f2e0b9]/85">
            {configured.reason} 你的记忆仍然安全地留在本机，助手会继续用检索模式回答。
          </p>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 text-[11px] leading-relaxed text-dim">
          <IconShield size={13} className="mt-0.5 shrink-0 text-violet/70" />
          隐私隔离在检索层完成：对方仅自己可见的内容，永远不会进入候选集，也不会被拼进模型请求。
        </div>

        <Link
          to="/app/settings#ai"
          className="inline-flex items-center gap-1 text-[11.5px] text-violet/85 hover:underline"
        >
          在设置中管理 AI 与隐私 <IconChevronRight size={12} />
        </Link>
      </section>

      <Dialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="启用模型增强回答？"
        description="开启后，只有在你主动提问时，才会把下列内容发送给服务端代理与模型提供商。"
        size="md"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConsentOpen(false)}>
              保持关闭
            </Button>
            <Button variant="primary" onClick={() => void onConsent()}>
              我已了解并启用
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12.5px] leading-relaxed text-mist/85">
          <ul className="list-disc space-y-2 pl-5">
            <li>会发送：你的问题，以及最多 5 条与问题最相关、且你有权查看的记忆标题、日期与摘录。</li>
            <li>不会发送：照片、音视频原件、时间胶囊正文、对方仅自己可见的内容、密码或登录令牌。</li>
            <li>调用由服务端完成，模型密钥不会出现在浏览器里。</li>
            <li>模型输出必须引用本次检索到的记录；引用校验失败会被整段丢弃，并回到检索答案。</li>
            <li>模型输出不会被写入记忆库，也不会自动创建新记录。</li>
            <li>随时可以在本页或设置中关闭。</li>
          </ul>
          {configured.reason && (
            <p className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[11.5px] text-dim">
              当前状态：{configured.reason}
            </p>
          )}
          <p className="text-[11px] text-dim/70">
            你在 {preference.consentAt ? formatDate(new Date(preference.consentAt)) : '本次'} 的选择会记录在本机/你的账号下。
          </p>
        </div>
      </Dialog>
    </div>
  );
}
