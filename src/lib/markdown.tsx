import type { ReactNode } from 'react';

/**
 * Minimal, safe Markdown renderer that builds React nodes directly.
 * Raw HTML in user content is never interpreted — it is shown as text.
 * Links are restricted to http(s) so a private page cannot be turned into an
 * XSS vector or trigger remote loads unexpectedly.
 */

const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_RE);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-i${index}`;
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
      return <del key={key}>{part.slice(2, -2)}</del>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer nofollow">
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function renderTextLines(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(<br key={`${keyPrefix}-br${index}`} />);
    nodes.push(...renderInline(line, `${keyPrefix}-l${index}`));
  });
  return nodes;
}

export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockIndex = 0;

  const push = (node: ReactNode) => {
    blocks.push(node);
    blockIndex += 1;
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const key = `b${blockIndex}`;

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      push(
        <pre key={key}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const content = renderInline(heading[2] ?? '', `${key}-h`);
      if (level === 1) push(<h1 key={key}>{content}</h1>);
      else if (level === 2) push(<h2 key={key}>{content}</h2>);
      else if (level === 3) push(<h3 key={key}>{content}</h3>);
      else push(<h4 key={key}>{content}</h4>);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      push(<hr key={key} />);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      push(<blockquote key={key}>{renderTextLines(quote, `${key}-q`)}</blockquote>);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*+]\s+/, ''));
        index += 1;
      }
      push(
        <ul key={key}>
          {items.map((item, itemIndex) => (
            <li key={`${key}-li${itemIndex}`}>{renderInline(item, `${key}-li${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, ''));
        index += 1;
      }
      push(
        <ol key={key}>
          {items.map((item, itemIndex) => (
            <li key={`${key}-li${itemIndex}`}>{renderInline(item, `${key}-li${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        !current.trim() ||
        current.trim().startsWith('```') ||
        /^(#{1,4})\s+/.test(current) ||
        /^\s*>\s?/.test(current) ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d+[.)]\s+/.test(current) ||
        /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    push(<p key={key}>{renderTextLines(paragraph, `${key}-p`)}</p>);
  }

  return <>{blocks}</>;
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return <div className={`prose-verse ${className ?? ''}`}>{renderMarkdown(children)}</div>;
}
