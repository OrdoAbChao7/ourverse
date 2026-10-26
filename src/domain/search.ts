/**
 * Chinese-aware keyword + date search. Deliberately deterministic: the same
 * question always produces the same sources, which is what makes citations
 * trustworthy. No embeddings, no hidden ranking service.
 */
import { monthKeyOf, parseLocalDate } from '@/lib/date';
import type { Memory } from './types';

const STOP_PHRASES = [
  '什么时候',
  '什么时间',
  '哪一天',
  '那一天',
  '在哪里',
  '哪儿',
  '哪里',
  '我们一起',
  '我们两个',
  '我们一起',
  '我们',
  '一起',
  '还记得',
  '记不记得',
  '记不记的',
  '有没有',
  '是什么',
  '怎么样',
  '哪些',
  '哪次',
  '那次',
  '去过',
  '去了',
  '大约',
  '大概',
  '告诉我',
  '请问',
  '记得',
  '那次',
  '当时',
  '当时我们',
  '我们我们',
].sort((a, b) => b.length - a.length);

const STOP_TOKENS = new Set([
  '什么', '时候', '哪里', '哪儿', '我们', '你们', '他们', '一起', '记得', '是否', '这个', '那个',
  '一个', '哪些', '怎么', '怎样', '为什', '么时', '候我', '们一', '起去', '去过', '了吗', '了吗',
  '多少', '几次', '第一', '最后', '最近', '之前', '以后', '现在', '那个', '这次', '那次', '还有',
  '可以', '能否', '知道', '告诉', '一次', '时候', '什么',
]);

const LATIN_OR_DIGIT = /[a-z0-9]+/gi;
const CJK_RUN = /[㐀-䶿一-鿿]+/g;

export interface Token {
  text: string;
  kind: 'latin' | 'cjk';
}

export function stripStopPhrases(input: string): string {
  let text = input.toLowerCase();
  for (const phrase of STOP_PHRASES) {
    text = text.split(phrase).join(' ');
  }
  return text;
}

/** CJK bigrams + latin words. Substring matching keeps recall high for Chinese. */
export function tokenize(input: string): Token[] {
  const text = stripStopPhrases(input);
  const tokens: Token[] = [];
  const seen = new Set<string>();

  const latinMatches = text.match(LATIN_OR_DIGIT) ?? [];
  for (const raw of latinMatches) {
    const value = raw.trim();
    if (value.length < 2) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    tokens.push({ text: value, kind: 'latin' });
  }

  const cjkMatches = text.match(CJK_RUN) ?? [];
  for (const run of cjkMatches) {
    if (run.length === 1) {
      if (!STOP_TOKENS.has(run) && !seen.has(run)) {
        seen.add(run);
        tokens.push({ text: run, kind: 'cjk' });
      }
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (STOP_TOKENS.has(bigram) || seen.has(bigram)) continue;
      seen.add(bigram);
      tokens.push({ text: bigram, kind: 'cjk' });
    }
  }

  return tokens;
}

export interface DateConstraint {
  kind: 'year' | 'month' | 'day' | 'month-day';
  label: string;
  year?: number;
  month?: number;
  day?: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Extracts explicit temporal constraints from natural language. Nothing is inferred. */
export function extractDateConstraint(question: string, now: Date = new Date()): DateConstraint | null {
  const full = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/.exec(question);
  if (full) {
    const year = Number(full[1]);
    const month = Number(full[2]);
    const day = Number(full[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { kind: 'day', label: `${year}年${month}月${day}日`, year, month, day };
    }
  }
  const iso = /(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(question);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = iso[3] ? Number(iso[3]) : undefined;
    if (month >= 1 && month <= 12 && (day === undefined || (day >= 1 && day <= 31))) {
      if (day === undefined) return { kind: 'month', label: `${year}年${month}月`, year, month };
      return { kind: 'day', label: `${year}年${month}月${day}日`, year, month, day };
    }
  }
  const yearMonth = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(question);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    if (month >= 1 && month <= 12) return { kind: 'month', label: `${year}年${month}月`, year, month };
  }
  const relativeYear = /(今年|去年|前年|去年|明年)/.exec(question);
  if (relativeYear) {
    const offset = relativeYear[1] === '去年' ? -1 : relativeYear[1] === '前年' ? -2 : relativeYear[1] === '明年' ? 1 : 0;
    const year = now.getFullYear() + offset;
    return { kind: 'year', label: `${year}年`, year };
  }
  const monthDay = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(question);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { kind: 'month-day', label: `${month}月${day}日`, month, day };
    }
  }
  const bareWeekday = /(周[一二三四五六日天])/.exec(question);
  if (bareWeekday) {
    // Weekday alone is ambiguous across months — surfaced as a hint, never as a filter.
    return null;
  }
  return null;
}

export function memoryMatchesDate(memory: Pick<Memory, 'occurredOn'>, constraint: DateConstraint | null): boolean {
  if (!constraint) return true;
  if (constraint.year === undefined) return true; // month-day handled in scoring
  const parts = memory.occurredOn.split('-').map(Number);
  const [year, month, day] = parts as [number, number, number];
  if (constraint.kind === 'year') return year === constraint.year;
  if (constraint.kind === 'month') return year === constraint.year && month === constraint.month;
  if (constraint.kind === 'day') {
    return year === constraint.year && month === constraint.month && day === constraint.day;
  }
  return true;
}

export interface ScoredMemory<T> {
  memory: T;
  score: number;
  matchedTokens: string[];
  excerpt: string;
}

function excerptAround(text: string, tokens: string[], fallbackLength = 140): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const lower = compact.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = lower.indexOf(token);
    if (index >= 0) break;
  }
  if (index < 0) return compact.length > fallbackLength ? `${compact.slice(0, fallbackLength)}…` : compact;
  const start = Math.max(0, index - 48);
  const end = Math.min(compact.length, index + 112);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

type SearchableMemory = Pick<Memory, 'title' | 'bodyMd' | 'tags' | 'locationLabel' | 'occurredOn'>;

export function scoreMemory<T extends SearchableMemory>(
  memory: T,
  tokens: Token[],
  constraint: DateConstraint | null,
): ScoredMemory<T> | null {
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
    if (constraint.kind === 'day' && memory.occurredOn === `${constraint.year}-${pad(constraint.month ?? 1)}-${pad(constraint.day ?? 1)}`) {
      score += 6;
    } else if (constraint.kind === 'month' && monthKeyOf(memory.occurredOn) === `${constraint.year}-${pad(constraint.month ?? 1)}`) {
      score += 4.5;
    } else if (constraint.kind === 'year' && memory.occurredOn.startsWith(`${constraint.year}-`)) {
      score += 4;
    } else if (constraint.kind === 'month-day') {
      const [, month, day] = memory.occurredOn.split('-');
      if (Number(month) === constraint.month && Number(day) === constraint.day) score += 4;
    }
  }

  if (tokens.length === 0 && !constraint) return null;
  if (score <= 0) return null;

  return {
    memory,
    score,
    matchedTokens: matched,
    excerpt: excerptAround(memory.bodyMd || memory.title, matched.length ? matched : [], 140),
  };
}

export function searchMemories<T extends SearchableMemory>(
  memories: T[],
  query: string,
  options: { now?: Date; limit?: number } = {},
): ScoredMemory<T>[] {
  const tokens = tokenize(query);
  const constraint = extractDateConstraint(query, options.now ?? new Date());
  if (tokens.length === 0 && !constraint) {
    return memories
      .slice()
      .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0))
      .slice(0, options.limit ?? memories.length)
      .map((memory) => ({ memory, score: 0, matchedTokens: [], excerpt: excerptAround(memory.bodyMd, [], 140) }));
  }
  return memories
    .map((memory) => scoreMemory(memory, tokens, constraint))
    .filter((value): value is ScoredMemory<T> => value !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.memory.occurredOn < b.memory.occurredOn ? 1 : -1;
    })
    .slice(0, options.limit ?? memories.length);
}

export function isValidDayConstraint(constraint: DateConstraint): boolean {
  if (constraint.year === undefined || constraint.month === undefined || constraint.day === undefined) return false;
  const date = parseLocalDate(
    `${constraint.year}-${pad(constraint.month)}-${pad(constraint.day)}`,
  );
  return date.getMonth() + 1 === constraint.month && date.getDate() === constraint.day;
}
