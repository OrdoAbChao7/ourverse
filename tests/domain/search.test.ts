import { describe, expect, it } from 'vitest';
import {
  extractDateConstraint,
  memoryMatchesDate,
  searchMemories,
  tokenize,
} from '@/domain/search';
import { memory } from '../helpers/fixtures';

const now = new Date(2026, 9, 26);

const fixtures = [
  memory({
    id: 'sea',
    title: '海边的第一场日落',
    bodyMd: '风把外套吹得鼓起来，我们沿着海岸线一直走到灯亮。',
    tags: ['海', '旅行'],
    locationLabel: '青岛 · 金沙滩',
    occurredOn: '2025-07-12',
    occurredAt: '2025-07-12T11:42:00.000Z',
  }),
  memory({
    id: 'rain',
    title: '雨夜里的面馆',
    bodyMd: '雨大得像有人在天上倒水，我们躲进巷子里的小店。',
    tags: ['日常', '雨'],
    occurredOn: '2025-03-08',
    occurredAt: '2025-03-08T13:15:00.000Z',
  }),
  memory({
    id: 'kitchen',
    title: '厨房里的第一次',
    bodyMd: '菜谱说少许盐，我们理解成了一大勺。',
    tags: ['厨房', '日常'],
    occurredOn: '2025-03-21',
    occurredAt: '2025-03-21T10:52:00.000Z',
  }),
];

describe('tokenize', () => {
  it('produces CJK bigrams and latin words, dropping question words', () => {
    const tokens = tokenize('我们什么时候去的海边 Paris').map((token) => token.text);
    expect(tokens).toContain('海边');
    expect(tokens).toContain('paris');
    expect(tokens).not.toContain('我们');
    expect(tokens).not.toContain('什么');
  });
});

describe('extractDateConstraint', () => {
  it('parses explicit YYYY年M月D日, YYYY年M月 and ISO forms', () => {
    expect(extractDateConstraint('2025年3月8日做了什么')).toMatchObject({ kind: 'day', year: 2025, month: 3, day: 8 });
    expect(extractDateConstraint('2025年3月有什么')).toMatchObject({ kind: 'month', year: 2025, month: 3 });
    expect(extractDateConstraint('2025-03-08')).toMatchObject({ kind: 'day', year: 2025, month: 3, day: 8 });
  });

  it('resolves 去年 relative to the given clock', () => {
    expect(extractDateConstraint('去年发生了什么', now)).toMatchObject({ kind: 'year', year: 2025 });
  });

  it('does not invent a constraint from vague wording', () => {
    expect(extractDateConstraint('很久以前')).toBeNull();
  });
});

describe('searchMemories', () => {
  it('finds a memory by Chinese keyword in the body', () => {
    const results = searchMemories(fixtures, '海岸线');
    expect(results[0]?.memory.id).toBe('sea');
  });

  it('ranks title and tag matches above body-only matches', () => {
    const results = searchMemories(fixtures, '厨房');
    expect(results[0]?.memory.id).toBe('kitchen');
  });

  it('filters strictly by month constraint', () => {
    const results = searchMemories(fixtures, '2025年3月');
    expect(results.map((entry) => entry.memory.id).sort()).toEqual(['kitchen', 'rain']);
  });

  it('returns all memories newest-first for an empty query', () => {
    const results = searchMemories(fixtures, '   ');
    expect(results.map((entry) => entry.memory.id)).toEqual(['sea', 'kitchen', 'rain']);
  });

  it('returns nothing for a keyword that does not exist', () => {
    expect(searchMemories(fixtures, '宠物')).toEqual([]);
  });

  it('matches a date without a keyword', () => {
    expect(memoryMatchesDate({ occurredOn: '2025-03-21' }, extractDateConstraint('2025年3月'))).toBe(true);
    expect(memoryMatchesDate({ occurredOn: '2025-04-01' }, extractDateConstraint('2025年3月'))).toBe(false);
  });
});
