import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from '@/lib/markdown';

describe('Markdown renderer', () => {
  it('renders headings, emphasis, lists and quotes without raw HTML', () => {
    const { container } = render(
      <Markdown>{'# 标题\n\n**粗体** 与 *斜体*\n\n- 一\n- 二\n\n> 引用'}</Markdown>,
    );
    expect(container.querySelector('h1')?.textContent).toBe('标题');
    expect(container.querySelector('strong')?.textContent).toBe('粗体');
    expect(container.querySelector('em')?.textContent).toBe('斜体');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('blockquote')?.textContent).toContain('引用');
  });

  it('escapes injected HTML instead of executing it', () => {
    const payload = '<img src=x onerror="alert(1)"><script>window.__pwned=1</script>';
    const { container } = render(<Markdown>{payload}</Markdown>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>window.__pwned=1</script>');
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('only linkifies http(s) URLs with safe rel attributes', () => {
    const { container } = render(
      <Markdown>{'[安全](https://example.com/page) [危险](javascript:alert(1))'}</Markdown>,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/page');
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
    expect(container.textContent).toContain('javascript:alert(1)');
  });

  it('renders fenced code blocks as text', () => {
    const { container } = render(<Markdown>{'```\nconst x = "<b>";\n```'}</Markdown>);
    expect(container.querySelector('pre code')?.textContent).toContain('const x = "<b>";');
    expect(container.querySelector('pre b')).toBeNull();
  });

  it('does not fetch remote images from Markdown', () => {
    const { container } = render(<Markdown>{'![remote](https://tracker.example/pixel.png)'}</Markdown>);
    expect(container.querySelector('img')).toBeNull();
  });
});
