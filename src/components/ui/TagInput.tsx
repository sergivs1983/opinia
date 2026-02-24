'use client';

import { useState, KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { ringAccent, textMain, textSub } from '@/components/ui/glass';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
}

export default function TagInput({ tags, onChange, label, placeholder = 'Afegir tag...' }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInputValue('');
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length) {
      removeTag(tags.length - 1);
    }
  };

  return (
    <div>
      {label && <label className={cn('block text-sm font-medium mb-1.5', textSub)}>{label}</label>}
      <div className={cn('flex flex-wrap gap-2 p-3 border border-white/14 rounded-xl bg-white/8 min-h-[48px] transition-all focus-within:border-brand-accent/45', ringAccent)}>
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-3 py-1 bg-brand-accent/20 text-emerald-300 border border-brand-accent/35 rounded-full text-sm font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="ml-0.5 transition-colors text-emerald-300/85 hover:text-emerald-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => inputValue && addTag(inputValue)}
          placeholder={tags.length === 0 ? placeholder : ''}
          className={cn('flex-1 min-w-[120px] outline-none text-sm bg-transparent placeholder:text-white/45', textMain)}
        />
      </div>
    </div>
  );
}
