import { formatDate } from '@/lib/date';
import type { AskIntent, AskSource, Confidence, RetrievalOutcome } from './retrieval';

export interface AskAnswer {
  mode: 'retrieval' | 'model';
  intent: AskIntent;
  answerMd: string;
  sources: AskSource[];
  confidence: Confidence;
  totalMatched: number;
  degradedReason: string | null;
  modelId: string | null;
  answeredAt: string;
}

export const NO_EVIDENCE_ANSWER =
  '暂无足够记录来回答这个问题。我没有在你的记忆库里找到可以支撑答案的内容，因此不会做推测。\n\n可以试试：换一个更具体的关键词、加上大致的时间（例如「2025年3月」），或先去时光长廊补上这段记忆。';

function sanitizeQuestion(question: string): string {
  return question.replace(/\s+/g, ' ').trim().slice(0, 60);
}

function sourceLine(source: AskSource): string {
  const date = formatDate(source.occurredOn);
  const time = source.occurredTime ? ` ${source.occurredTime}` : '';
  return `- [${source.index}] 《${source.title}》 · ${date}${time} · ${source.authorName}`;
}

export function composeRetrievalAnswer(
  question: string,
  outcome: RetrievalOutcome,
  now: Date = new Date(),
): AskAnswer {
  const { analysis, sources, confidence, totalMatched } = outcome;
  let answerMd: string;

  if (analysis.intent === 'count') {
    if (totalMatched === 0) {
      answerMd = `在你可见的记录中，没有找到与「${sanitizeQuestion(question)}」相符的记忆。`;
    } else {
      const exampleLines = sources.map(sourceLine).join('\n');
      answerMd = `在你可见的记录中，符合「${sanitizeQuestion(question)}」条件的记忆共有 **${totalMatched} 条**。\n\n${
        sources.length ? `其中最近的几条：\n${exampleLines}` : ''
      }`;
    }
  } else if (confidence === 'none') {
    answerMd = NO_EVIDENCE_ANSWER;
  } else if (analysis.intent === 'earliest' || analysis.intent === 'latest') {
    const first = sources[0];
    const which = analysis.intent === 'earliest' ? '最早' : '最近';
    if (!first) {
      answerMd = NO_EVIDENCE_ANSWER;
    } else {
      answerMd = `记录中${which}的一条是《${first.title}》，发生在 **${formatDate(first.occurredOn)}${
        first.occurredTime ? ` ${first.occurredTime}` : ''
      }**。\n\n${
        first.excerpt ? `> ${first.excerpt}\n\n` : ''
      }（依据记录 [${first.index}]，来自 ${first.authorName}。）`;
    }
  } else {
    const lines = sources.map(sourceLine).join('\n');
    const intro =
      confidence === 'strong'
        ? `根据 ${sources.length} 条记录，与「${sanitizeQuestion(question)}」最接近的内容是：`
        : `只找到 ${sources.length} 条可能相关的记录，还不足以下结论，请自行确认：`;
    answerMd = `${intro}\n\n${lines}`;
  }

  return {
    mode: 'retrieval',
    intent: analysis.intent,
    answerMd,
    sources,
    confidence,
    totalMatched,
    degradedReason: null,
    modelId: null,
    answeredAt: now.toISOString(),
  };
}
