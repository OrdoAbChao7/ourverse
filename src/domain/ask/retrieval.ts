import { canViewMemory, type Viewer } from '../permissions';
import { extractDateConstraint, memoryMatchesDate, tokenize, type DateConstraint, type Token } from '../search';
import type { MemoryWithAuthor } from '../types';

export type AskIntent = 'count' | 'earliest' | 'latest' | 'lookup';

export interface AskSource {
  index: number;
  memoryId: string;
  title: string;
  occurredOn: string;
  occurredTime: string | null;
  authorName: string;
  visibility: 'shared' | 'private';
  excerpt: string;
  score: number;
  matchedTokens: string[];
}

export interface QuestionAnalysis {
  tokens: Token[];
  constraint: DateConstraint | null;
  intent: AskIntent;
}

export type Confidence = 'strong' | 'weak' | 'none';

export interface RetrievalOutcome {
  analysis: QuestionAnalysis;
  sources: AskSource[];
  confidence: Confidence;
  /** Number of permitted memories that satisfied the question (exact for count questions). */
  totalMatched: number;
  candidateCount: number;
}

const INTENT_COUNT = /(多少|几条|几个|几次|一共|总共|数量|统计)/;
const INTENT_EARLIEST = /(第一次|最早|最初|头一次)/;
const INTENT_LATEST = /(最近|最新|最后一次|上一次|上回)/;

/**
 * Words that describe the archive rather than its content. The intent parser
 * already understands them, so leaving them as keywords would make
 * "我们一共有多少条记忆" match nothing and return a wrong count.
 */
const GENERIC_TOKENS = new Set([
  '记忆',
  '记录',
  '一条',
  '一次',
  '第一次',
  '最早',
  '最近',
  '最新',
  '最后',
  '上一次',
  '上回',
  '时间',
  '时候',
  '内容',
  '一共',
  '总共',
  '数量',
  '多少',
  '几条',
  '几个',
  '几次',
]);

/**
 * Archive-structure phrases are stripped *before* tokenising, so they cannot
 * produce junk bigrams like 条记 that make an otherwise empty query look like
 * a keyword search. Intent and date parsing still see the original question.
 */
const ARCHIVE_PHRASES = [
  '最后一次',
  '什么时候',
  '什么时间',
  '第一次',
  '上一次',
  '一共有',
  '多少条',
  '多少个',
  '多少次',
  '哪一天',
  '有哪些',
  '有什么',
  '最近',
  '最新',
  '最早',
  '最初',
  '上回',
  '几条',
  '几个',
  '几次',
  '一条',
  '一次',
  '记忆',
  '记录',
  '多少',
  '一共',
  '总共',
  '数量',
].sort((a, b) => b.length - a.length);

const DATE_PATTERNS = [
  /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?/g,
  /\d{4}\s*年\s*\d{1,2}\s*月/g,
  /\d{4}-\d{1,2}(?:-\d{1,2})?/g,
  /(?:今年|去年|前年|明年)/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*日/g,
  /\d{1,2}\s*月份?/g,
];

function stripArchivePhrases(question: string): string {
  let text = question;
  for (const phrase of ARCHIVE_PHRASES) text = text.split(phrase).join(' ');
  // The date is handled by extractDateConstraint; leaving its digits in the
  // token stream would turn a pure date question into a keyword search.
  for (const pattern of DATE_PATTERNS) text = text.replace(pattern, ' ');
  return text;
}

export function analyzeQuestion(question: string, now: Date): QuestionAnalysis {
  const intent: AskIntent = INTENT_COUNT.test(question)
    ? 'count'
    : INTENT_EARLIEST.test(question)
      ? 'earliest'
      : INTENT_LATEST.test(question)
        ? 'latest'
        : 'lookup';
  return {
    tokens: tokenize(stripArchivePhrases(question)).filter((token) => !GENERIC_TOKENS.has(token.text)),
    constraint: extractDateConstraint(question, now),
    intent,
  };
}

function excerptOf(body: string, tokens: string[], length = 160): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const lower = compact.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = lower.indexOf(token);
    if (index >= 0) break;
  }
  if (index < 0) return compact.length > length ? `${compact.slice(0, length)}…` : compact;
  const start = Math.max(0, index - 52);
  const end = Math.min(compact.length, index + 120);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

interface Scored {
  memory: MemoryWithAuthor;
  score: number;
  matched: string[];
}

function scoreFor(memory: MemoryWithAuthor, tokens: Token[], constraint: DateConstraint | null): Scored | null {
  if (!memoryMatchesDate(memory, constraint)) return null;
  const title = memory.title.toLowerCase();
  const body = memory.bodyMd.toLowerCase();
  const tags = memory.tags.join(' ').toLowerCase();
  const location = (memory.locationLabel ?? '').toLowerCase();

  let score = 0;
  const matched: string[] = [];
  for (const token of tokens) {
    let tokenScore = 0;
    if (title.includes(token.text)) tokenScore += 3.2;
    if (tags.includes(token.text)) tokenScore += 2.6;
    if (location.includes(token.text)) tokenScore += 2.2;
    if (body.includes(token.text)) tokenScore += 1.1;
    if (tokenScore > 0) {
      matched.push(token.text);
      score += tokenScore;
    }
  }

  if (constraint) {
    let dateHit = false;
    if (constraint.kind === 'day') {
      const iso = `${constraint.year}-${String(constraint.month).padStart(2, '0')}-${String(constraint.day).padStart(2, '0')}`;
      dateHit = memory.occurredOn === iso;
    } else if (constraint.kind === 'month') {
      dateHit = memory.occurredOn.startsWith(`${constraint.year}-${String(constraint.month).padStart(2, '0')}-`);
    } else if (constraint.kind === 'year') {
      dateHit = memory.occurredOn.startsWith(`${constraint.year}-`);
    } else if (constraint.kind === 'month-day') {
      const [, month, day] = memory.occurredOn.split('-');
      dateHit = Number(month) === constraint.month && Number(day) === constraint.day;
    }
    // A date narrows the search; it only counts as evidence when it is the
    // whole question or the keywords themselves matched.
    if (dateHit && (tokens.length === 0 || matched.length > 0)) score += 5;
    else if (!dateHit && tokens.length === 0) return null;
    else if (!dateHit && matched.length === 0) return null;
  }

  if (score <= 0) return null;
  return { memory, score, matched };
}

export interface RetrieveOptions {
  viewer: Viewer;
  now: Date;
  limit?: number;
}

function byNewest(a: MemoryWithAuthor, b: MemoryWithAuthor): number {
  return a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0;
}

/**
 * Retrieval is the privacy boundary for the assistant: memories the viewer may
 * not read never enter the candidate set, so they cannot leak through a model
 * prompt or an answer later on.
 */
export function retrieveSources(
  memories: MemoryWithAuthor[],
  question: string,
  options: RetrieveOptions,
): RetrievalOutcome {
  const { viewer, now } = options;
  const limit = options.limit ?? 5;
  const analysis = analyzeQuestion(question, now);
  const permitted = memories.filter((memory) => canViewMemory(viewer, memory));
  const hasKeywordQuery = analysis.tokens.length > 0 || analysis.constraint !== null;

  let scoredList: Scored[];
  if (hasKeywordQuery) {
    scoredList = [];
    for (const memory of permitted) {
      const scored = scoreFor(memory, analysis.tokens, analysis.constraint);
      if (scored) scoredList.push(scored);
    }
  } else {
    scoredList = permitted
      .slice()
      .sort(byNewest)
      .map((memory) => ({ memory, score: 0, matched: [] as string[] }));
  }

  const wantsOldest = analysis.intent === 'earliest';
  const dateOrderedIntent = analysis.intent === 'earliest' || analysis.intent === 'latest';
  scoredList.sort((a, b) => {
    if (!dateOrderedIntent && b.score !== a.score) return b.score - a.score;
    return wantsOldest ? -byNewest(a.memory, b.memory) : byNewest(a.memory, b.memory);
  });

  const displayCap = analysis.intent === 'count' ? 3 : limit;
  const sources: AskSource[] = scoredList.slice(0, displayCap).map((entry, index) => ({
    index: index + 1,
    memoryId: entry.memory.id,
    title: entry.memory.title,
    occurredOn: entry.memory.occurredOn,
    occurredTime: entry.memory.occurredTime,
    authorName: entry.memory.author.displayName,
    visibility: entry.memory.visibility,
    excerpt: excerptOf(entry.memory.bodyMd || entry.memory.title, entry.matched),
    score: entry.score,
    matchedTokens: entry.matched,
  }));

  let confidence: Confidence = 'none';
  if (analysis.intent === 'count') {
    // A count is computed from rows the viewer can already see — always exact.
    confidence = scoredList.length > 0 ? 'strong' : 'weak';
  } else if (!hasKeywordQuery) {
    confidence = analysis.intent === 'latest' || analysis.intent === 'earliest' ? (scoredList.length ? 'strong' : 'none') : 'none';
  } else if (scoredList.length > 0) {
    const top = scoredList[0];
    const tokenCount = Math.max(1, analysis.tokens.length);
    const coverage = top ? top.matched.length / tokenCount : 0;
    const dateHit = Boolean(
      analysis.constraint && top && memoryMatchesDate(top.memory, analysis.constraint),
    );
    if (((top?.score ?? 0) >= 3.1 && coverage >= 0.5) || dateHit) confidence = 'strong';
    else if ((top?.score ?? 0) >= 1.05) confidence = 'weak';
    else confidence = 'none';
  }

  return {
    analysis,
    sources: confidence === 'none' ? [] : sources,
    confidence,
    totalMatched: scoredList.length,
    candidateCount: permitted.length,
  };
}
