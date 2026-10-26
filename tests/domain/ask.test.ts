import { describe, expect, it, vi } from 'vitest';
import type { MemoryWithAuthor } from '@/domain/types';
import { memory } from '../helpers/fixtures';
import { retrieveSources } from '@/domain/ask/retrieval';
import { composeRetrievalAnswer, NO_EVIDENCE_ANSWER } from '@/domain/ask/answer';
import { FakeAskModel, runModel, toModelSources } from '@/domain/ask/model';

const now = new Date(2026, 9, 26, 12, 0);
const viewerA = { userId: 'user-a', isMemberOfSpace: true };
const viewerB = { userId: 'user-b', isMemberOfSpace: true };

function fixture(): MemoryWithAuthor[] {
  const rows: MemoryWithAuthor[] = [
    memory({ id: 'm01', authorId: 'user-a', title: '认识的第一天', bodyMd: '城南咖啡馆，第一次见面。', occurredOn: '2024-09-01', occurredAt: '2024-09-01T04:00:00.000Z' }),
    memory({ id: 'm02', authorId: 'user-b', title: '雨夜里的面馆', bodyMd: '雨天躲进巷子里的面馆，热气把玻璃蒙住了。', occurredOn: '2025-03-08', occurredAt: '2025-03-08T13:00:00.000Z' }),
    memory({ id: 'm03', authorId: 'user-a', title: '厨房里的第一次', bodyMd: '厨房里手忙脚乱，汤咸得像海水。', occurredOn: '2025-03-21', occurredAt: '2025-03-21T10:00:00.000Z' }),
    memory({ id: 'm04', authorId: 'user-b', title: '山顶的日出', bodyMd: '凌晨爬上山，山顶很冷，日出时天一点点亮起来。', occurredOn: '2025-05-02', occurredAt: '2025-05-02T21:00:00.000Z' }),
    memory({ id: 'm05', authorId: 'user-a', title: '海边的第一场日落', bodyMd: '第一次一起看海，海边、日落、青岛，沿着海岸线一直走。', tags: ['海'], occurredOn: '2025-07-12', occurredAt: '2025-07-12T11:00:00.000Z' }),
    memory({ id: 'm06', authorId: 'user-b', title: '夜车旅行', bodyMd: '坐火车旅行，月亮掉在没有名字的湖面上。', tags: ['旅行'], occurredOn: '2025-09-10', occurredAt: '2025-09-10T15:00:00.000Z' }),
    memory({ id: 'm07', authorId: 'user-a', visibility: 'private', title: 'A的私人记录', bodyMd: '只属于我的秘密：紫色潜水艇。', occurredOn: '2026-10-01', occurredAt: '2026-10-01T04:00:00.000Z' }),
    memory({ id: 'm08', authorId: 'user-b', visibility: 'private', title: 'B的秘密草稿', bodyMd: '蓝色风筝，只写给自己的段落。', occurredOn: '2024-01-01', occurredAt: '2024-01-01T04:00:00.000Z' }),
    memory({ id: 'm09', authorId: 'user-a', title: '阳台上的月亮', bodyMd: '月亮升得很快，云走过去时像在呼吸。', occurredOn: '2025-11-02', occurredAt: '2025-11-02T14:00:00.000Z' }),
    memory({ id: 'm10', authorId: 'user-b', title: '搬家那天', bodyMd: '纸箱堆到天花板，旧台灯闪了两下亮了。', occurredOn: '2025-12-20', occurredAt: '2025-12-20T08:00:00.000Z' }),
    memory({ id: 'm11', authorId: 'user-a', title: '写下的话', bodyMd: '一个很普通的日子。', occurredOn: '2026-02-14', occurredAt: '2026-02-14T04:00:00.000Z' }),
    memory({ id: 'm12', authorId: 'user-b', title: '最近的一次旅行', bodyMd: '旅行、海边、傍晚的风。', tags: ['旅行'], occurredOn: '2026-09-05', occurredAt: '2026-09-05T10:00:00.000Z' }),
  ];
  return rows.map((row) => ({
    ...row,
    author: { id: row.authorId, displayName: row.authorId === 'user-a' ? '林雾' : '江照' },
  }));
}

const memories = fixture();

function ask(question: string, viewer = viewerA) {
  const outcome = retrieveSources(memories, question, { viewer, now });
  const answer = composeRetrievalAnswer(question, outcome, now);
  return { outcome, answer };
}

describe('20-question retrieval suite', () => {
  describe('8 answerable questions return locatable source IDs', () => {
    const cases: { question: string; expectId: string }[] = [
      { question: '我们第一次看海是什么时候？', expectId: 'm05' },
      { question: '最近一次旅行去了哪里？', expectId: 'm12' },
      { question: '厨房里发生过什么？', expectId: 'm03' },
      { question: '我们最早的一条记忆是什么？', expectId: 'm01' },
      { question: '雨天的记录有哪些？', expectId: 'm02' },
      { question: '山顶看日出是什么时候？', expectId: 'm04' },
    ];

    for (const { question, expectId } of cases) {
      it(question, () => {
        const { answer } = ask(question);
        expect(answer.confidence).not.toBe('none');
        expect(answer.sources.map((source) => source.memoryId)).toContain(expectId);
        expect(answer.answerMd).toMatch(/\[1\]|\[2\]|\[3\]/);
      });
    }

    it('counts only what this viewer may see', () => {
      const { answer } = ask('我们一共有多少条记忆？');
      expect(answer.answerMd).toContain('11 条');
      expect(answer.totalMatched).toBe(11);
      expect(answer.sources.length).toBeGreaterThan(0);
    });

    it('filters strictly by an explicit month', () => {
      const { answer } = ask('2025年3月有什么记录？');
      expect(answer.sources.map((source) => source.occurredOn)).toEqual(['2025-03-21', '2025-03-08']);
      expect(answer.confidence).toBe('strong');
    });
  });

  describe('6 unanswerable questions refuse instead of inventing', () => {
    const questions = [
      '我们养过什么宠物？',
      '对方最喜欢哪本书？',
      '我们去过巴黎吗？',
      '我们的婚礼在哪里举行？',
      '去年冬天买的车是什么颜色？',
      '我们上一次吵架的原因？',
    ];
    for (const question of questions) {
      it(question, () => {
        const { answer } = ask(question);
        expect(answer.confidence).toBe('none');
        expect(answer.sources).toEqual([]);
        expect(answer.answerMd).toBe(NO_EVIDENCE_ANSWER);
        expect(answer.answerMd).not.toMatch(/\d{4}年\d{1,2}月/);
      });
    }
  });

  describe('6 isolation questions never leak A’s private content to B', () => {
    it('cannot retrieve A’s private keyword', () => {
      const { answer } = ask('紫色潜水艇', viewerB);
      expect(answer.confidence).toBe('none');
      expect(answer.answerMd).not.toContain('潜水艇');
      expect(answer.sources).toEqual([]);
    });

    it('cannot retrieve A’s private title', () => {
      const { answer } = ask('A的私人记录', viewerB);
      expect(answer.sources.map((source) => source.memoryId)).not.toContain('m07');
      expect(answer.answerMd).not.toContain('A的私人记录');
    });

    it('counts only B-visible rows', () => {
      const { answer } = ask('我们一共有多少条记忆？', viewerB);
      expect(answer.totalMatched).toBe(11);
      expect(answer.answerMd).toContain('11 条');
      // B sees 12 total minus A's private row.
      expect(answer.sources.every((source) => source.memoryId !== 'm07')).toBe(true);
    });

    it('“latest” for B is not A’s newest private memory', () => {
      const { answer } = ask('最近的一条记忆是什么？', viewerB);
      expect(answer.sources[0]?.memoryId).toBe('m12');
      expect(answer.answerMd).not.toContain('潜水艇');
    });

    it('a shared keyword query never includes the private row', () => {
      const { answer } = ask('月亮', viewerB);
      expect(answer.sources.map((source) => source.memoryId)).not.toContain('m07');
      expect(answer.sources.some((source) => source.memoryId === 'm09')).toBe(true);
    });

    it('A can still see their own private row (isolation is directional)', () => {
      const { answer } = ask('紫色潜水艇', viewerA);
      expect(answer.sources[0]?.memoryId).toBe('m07');
      expect(answer.answerMd).toContain('紫色潜水艇');
    });
  });
});

describe('model adapter safety', () => {
  const outcome = retrieveSources(memories, '海边', { viewer: viewerA, now });
  const sources = toModelSources(outcome.sources);

  it('accepts a valid answer with authorised citations', async () => {
    const model = new FakeAskModel((request) => ({
      answerMd: `根据记录 [1]，${request.sources[0]?.title ?? ''} 发生在 ${request.sources[0]?.occurredOn ?? ''}。`,
      citedMemoryIds: [request.sources[0]?.id ?? ''],
    }));
    const result = await runModel(model, { question: '海边', sources, locale: 'zh-CN', spaceName: '测试' });
    expect(result.citedMemoryIds).toEqual([sources[0]?.id]);
  });

  it('rejects references to memories outside the retrieval set', async () => {
    const model = new FakeAskModel(() => ({
      answerMd: '根据记录 [1]，那天很好。',
      citedMemoryIds: [sources[0]?.id ?? '', 'm07'],
    }));
    await expect(
      runModel(model, { question: '海边', sources, locale: 'zh-CN', spaceName: '测试' }),
    ).rejects.toThrow(/未授权/);
  });

  it('rejects answers without citation markers', async () => {
    const model = new FakeAskModel(() => ({ answerMd: '那天很好。', citedMemoryIds: [sources[0]?.id ?? ''] }));
    await expect(
      runModel(model, { question: '海边', sources, locale: 'zh-CN', spaceName: '测试' }),
    ).rejects.toThrow(/来源/);
  });

  it('rejects out-of-range citation markers', async () => {
    const model = new FakeAskModel(() => ({ answerMd: '根据记录 [9]。', citedMemoryIds: [sources[0]?.id ?? ''] }));
    await expect(
      runModel(model, { question: '海边', sources, locale: 'zh-CN', spaceName: '测试' }),
    ).rejects.toThrow(/不存在/);
  });

  it('rejects empty answers and missing citations', async () => {
    const empty = new FakeAskModel(() => ({ answerMd: '   ', citedMemoryIds: [sources[0]?.id ?? ''] }));
    await expect(
      runModel(empty, { question: '海边', sources, locale: 'zh-CN', spaceName: '测试' }),
    ).rejects.toThrow(/空内容/);
    const uncited = new FakeAskModel(() => ({ answerMd: '根据记录 [1]。', citedMemoryIds: [] }));
    await expect(
      runModel(uncited, { question: '海边', sources, locale: 'zh-CN', spaceName: '测试' }),
    ).rejects.toThrow(/没有给出引用/);
  });

  it('times out and returns a recoverable error', async () => {
    const model = new FakeAskModel(() => new Promise<never>(() => undefined));
    await expect(
      runModel(model, { question: '海边', sources, locale: 'zh-CN', spaceName: '测试' }, { timeoutMs: 30 }),
    ).rejects.toThrow(/超时/);
  });

  it('never calls the model for questions with no evidence', async () => {
    const handler = vi.fn(() => ({ answerMd: '不应该被调用 [1]', citedMemoryIds: [sources[0]?.id ?? ''] }));
    const model = new FakeAskModel(handler);
    const empty = retrieveSources(memories, '婚礼在哪里举行', { viewer: viewerA, now });
    const answer = composeRetrievalAnswer('婚礼在哪里举行', empty, now);
    if (empty.confidence !== 'none' && empty.sources.length > 0) {
      await runModel(model, { question: '婚礼在哪里举行', sources: toModelSources(empty.sources), locale: 'zh-CN', spaceName: '测试' });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(answer.mode).toBe('retrieval');
    expect(answer.sources).toEqual([]);
  });
});
