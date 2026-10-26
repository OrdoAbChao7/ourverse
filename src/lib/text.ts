/** Text helpers used by cards, meta descriptions and the assistant UI. */

export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerpt(markdown: string, length = 110): string {
  const text = plainText(markdown);
  if (text.length <= length) return text;
  return `${text.slice(0, length)}…`;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  // Chinese names: last character reads best as an initial-like mark.
  if (/[一-鿿]/.test(trimmed)) return trimmed.slice(-1);
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

export function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function pluralCount(count: number, unit: string): string {
  return `${count} ${unit}`;
}
