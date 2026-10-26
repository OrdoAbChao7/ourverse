import { useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { IconClose, IconPlus } from '../icons';

export function TagInput({
  value,
  onChange,
  suggestions = [],
  max = 12,
  placeholder = '输入标签后按回车',
  id,
  invalid = false,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  max?: number;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState('');

  function addTag(raw: string) {
    const tag = raw.trim().replace(/^#/, '').slice(0, 24);
    if (!tag) return;
    if (value.includes(tag) || value.length >= max) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault();
      addTag(draft);
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const available = suggestions.filter((tag) => !value.includes(tag)).slice(0, 8);

  return (
    <div className="space-y-2.5">
      <div
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-[rgba(8,17,31,0.55)] px-2 py-1.5 transition-colors focus-within:border-violet/50 focus-within:ring-2 focus-within:ring-violet/15',
          invalid && 'border-rose/45',
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-violet/25 bg-violet/[0.09] pl-2.5 pr-1 text-[12.5px] text-[#dfd3f4]"
          >
            #{tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((item) => item !== tag))}
              aria-label={`移除标签 ${tag}`}
              className="rounded p-0.5 text-violet/70 transition-colors hover:bg-white/10 hover:text-ink"
            >
              <IconClose size={11} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => addTag(draft)}
          placeholder={value.length === 0 ? placeholder : value.length >= max ? '标签已达上限' : '继续添加'}
          disabled={value.length >= max}
          className="h-7 min-w-28 flex-1 bg-transparent px-1 text-[13.5px] text-ink outline-none placeholder:text-mist/40"
          aria-label="添加标签"
        />
      </div>
      {available.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-dim">常用：</span>
          {available.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => addTag(tag)}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-white/8 px-2 text-[11.5px] text-dim transition-colors hover:border-white/20 hover:text-mist"
            >
              <IconPlus size={10} /> {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
