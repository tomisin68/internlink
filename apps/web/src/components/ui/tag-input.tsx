import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  max?: number;
  /** Tap-to-add shortcuts shown below the field. */
  suggestions?: string[];
  error?: boolean;
  id?: string;
  describedBy?: string;
}

/**
 * Chip input for skills.
 *
 * Commits on Enter, Tab and comma — comma because people paste
 * "React, TypeScript, Figma" out of a CV and expect it to just work. Backspace
 * on an empty field removes the last chip, which is the convention every
 * chip input has trained users on.
 */
export function TagInput({
  value,
  onChange,
  placeholder = 'Type a skill and press Enter',
  max = 30,
  suggestions = [],
  error = false,
  id,
  describedBy,
}: TagInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const normalised = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);
  const atCapacity = value.length >= max;

  const availableSuggestions = suggestions
    .filter((s) => !normalised.has(s.toLowerCase()))
    .slice(0, 8);

  function addTags(raw: string): void {
    const candidates = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (candidates.length === 0) return;

    const next = [...value];
    const seen = new Set(normalised);

    for (const candidate of candidates) {
      if (next.length >= max) break;
      const key = candidate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(candidate.slice(0, 48));
    }

    onChange(next);
    setDraft('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTags(draft);
      return;
    }
    // Tab only commits when there is something to commit — otherwise it must
    // keep moving focus, or the field becomes a keyboard trap.
    if (event.key === 'Tab' && draft.trim()) {
      event.preventDefault();
      addTags(draft);
      return;
    }
    if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'flex min-h-11 cursor-text flex-wrap items-center gap-1.5 rounded-xl border bg-surface p-2 transition-[border-color,box-shadow] duration-[160ms]',
          error
            ? 'border-danger focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_18%,transparent)]'
            : 'border-border-default hover:border-border-strong focus-within:border-brand focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)]',
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {value.map((tag) => (
            <motion.span
              key={tag.toLowerCase()}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-subtle py-1 pr-1 pl-2.5 text-sm font-medium text-brand-fg"
            >
              {tag}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((v) => v !== tag));
                }}
                aria-label={`Remove ${tag}`}
                className="flex size-5 cursor-pointer items-center justify-center rounded transition-colors hover:bg-brand-border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>

        <input
          ref={inputRef}
          id={id}
          type="text"
          value={draft}
          disabled={atCapacity}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          // Commit whatever is half-typed when focus leaves — losing it on blur
          // is a small betrayal users notice.
          onBlur={() => draft.trim() && addTags(draft)}
          placeholder={atCapacity ? `Maximum ${max} reached` : value.length === 0 ? placeholder : ''}
          aria-describedby={describedBy}
          aria-invalid={error || undefined}
          className="h-8 min-w-40 flex-1 bg-transparent px-1.5 text-base outline-none placeholder:text-fg-faint disabled:cursor-not-allowed"
        />
      </div>

      {availableSuggestions.length > 0 && !atCapacity && (
        <div className="flex flex-wrap gap-1.5">
          <span className="py-1 text-xs text-fg-subtle">Popular:</span>
          {availableSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTags(suggestion)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border-default px-2 py-1 text-xs font-medium text-fg-muted transition-colors duration-[160ms] hover:border-brand-border hover:bg-brand-subtle hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <Plus aria-hidden="true" className="size-3" />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
