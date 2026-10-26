import type { Accent } from '@/domain/types';

export const ACCENT_META: Record<Accent, { label: string; hex: string; rgb: string; description: string }> = {
  violet: { label: '星雾紫', hex: '#b9a1e8', rgb: '185, 161, 232', description: '默认的星雾色，安静、偏冷。' },
  gold: { label: '暖星金', hex: '#f0d49c', rgb: '240, 212, 156', description: '更温暖的微光，像黄昏后的星。' },
  cyan: { label: '银河青', hex: '#82c5cf', rgb: '130, 197, 207', description: '清透的青色，像很远的银河。' },
};

export function accentMeta(accent: Accent) {
  return ACCENT_META[accent] ?? ACCENT_META.violet;
}

export function applyAccent(accent: Accent): void {
  const meta = accentMeta(accent);
  document.documentElement.style.setProperty('--space-accent', meta.hex);
  document.documentElement.style.setProperty('--space-accent-rgb', meta.rgb);
}
