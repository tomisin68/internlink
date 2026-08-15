import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PostReactor } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { feedApi, queryKeys } from '@/lib/api-endpoints';

/**
 * A text field that offers people to tag when you type `@`.
 *
 * Built around a plain `textarea`/`input` rather than a contenteditable rich
 * editor. The body is stored as text and marked up on read (see `RichText`), so
 * there is nothing here that a rich editor would buy — and a contenteditable
 * costs IME support, paste handling and mobile caret behaviour, all of which
 * are hard to get right and very easy to get subtly wrong.
 *
 * The suggestion list is keyboard-driven because a picker you can only use with
 * a mouse is unusable on the half of this product that is a phone with a
 * hardware keyboard attached, and unreachable for anyone not using a pointer.
 */

/** The `@…` run the caret currently sits in, if any. */
function activeQuery(value: string, caret: number): { term: string; start: number } | null {
  const upToCaret = value.slice(0, caret);
  const at = upToCaret.lastIndexOf('@');
  if (at === -1) return null;

  // An `@` only opens the picker at a word boundary — "name@example.com" is an
  // email address, not a tag.
  const before = at === 0 ? ' ' : upToCaret[at - 1]!;
  if (!/\s/.test(before)) return null;

  const term = upToCaret.slice(at + 1);
  // A newline closes it, and so does a long run: past a couple of words the
  // user is writing prose, not picking a name.
  if (/\n/.test(term) || term.split(/\s+/).length > 2) return null;

  return { term, start: at };
}

export interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  'aria-label': string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  multiline?: boolean;
  className?: string;
  onSubmit?: () => void;
  /**
   * Plain Enter submits (Shift+Enter still breaks the line).
   *
   * For message composers, where that is the convention every chat app has
   * trained people on. Off elsewhere, because a post composer that sends on
   * Enter loses a paragraph the first time someone tries to write two.
   */
  submitOnEnter?: boolean;
}

export function MentionInput({
  value,
  onChange,
  placeholder,
  rows = 2,
  maxLength,
  disabled,
  multiline = true,
  className,
  onSubmit,
  submitOnEnter = false,
  ...aria
}: MentionInputProps) {
  const fieldRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [query, setQuery] = useState<{ term: string; start: number } | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const { data } = useQuery({
    queryKey: queryKeys.mentionCandidates(query?.term ?? ''),
    queryFn: () => feedApi.mentionCandidates(query?.term ?? ''),
    enabled: query !== null,
    // The candidate set is someone's own network — it does not change between
    // keystrokes, so refetching per character would be pure waste.
    staleTime: 60_000,
  });

  const suggestions = data?.items ?? [];

  useEffect(() => setHighlighted(0), [query?.term]);

  function syncQuery(next: string, caret: number): void {
    setQuery(activeQuery(next, caret));
  }

  function insert(person: PostReactor): void {
    if (!query) return;
    const field = fieldRef.current;
    const caret = field?.selectionStart ?? value.length;

    const before = value.slice(0, query.start);
    const after = value.slice(caret);
    const next = `${before}@${person.displayName} ${after}`;

    onChange(next);
    setQuery(null);

    // Put the caret after the inserted name rather than at the end — people
    // routinely tag someone mid-sentence and then keep typing.
    const position = before.length + person.displayName.length + 2;
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(position, position);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (query && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((i) => (i + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const person = suggestions[highlighted];
        if (person) insert(person);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }

    if (!onSubmit || event.key !== 'Enter') return;

    // Cmd/Ctrl+Enter always submits, so a multi-line composer has a keyboard
    // path that does not require reaching for the button. Plain Enter only
    // submits where the caller asked for chat semantics.
    const chord = event.metaKey || event.ctrlKey;
    if (chord || (submitOnEnter && !event.shiftKey)) {
      event.preventDefault();
      onSubmit();
    }
  }

  const shared = {
    ref: fieldRef,
    value,
    disabled,
    maxLength,
    placeholder,
    onKeyDown: handleKeyDown,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      onChange(event.target.value);
      syncQuery(event.target.value, event.target.selectionStart ?? event.target.value.length);
    },
    onClick: (event: React.MouseEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const target = event.currentTarget;
      syncQuery(target.value, target.selectionStart ?? target.value.length);
    },
    // A blur that fires before the click on a suggestion would close the list
    // out from under the tap, so dismissal is deferred a frame.
    onBlur: () => window.setTimeout(() => setQuery(null), 120),
    'aria-expanded': query !== null && suggestions.length > 0,
    'aria-autocomplete': 'list' as const,
    ...aria,
  };

  return (
    <div className="relative min-w-0 flex-1">
      {multiline ? (
        <textarea {...shared} rows={rows} className={className} />
      ) : (
        <input {...shared} type="text" className={className} />
      )}

      {query !== null && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="People you can tag"
          className="absolute bottom-full left-0 z-30 mb-1 max-h-60 w-full max-w-xs overflow-y-auto rounded-xl border border-border-default bg-surface p-1 shadow-lg"
        >
          {suggestions.map((person, index) => (
            <li key={person.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                // `onMouseDown` rather than `onClick`: the field's blur fires
                // first on a click and would tear the list down mid-press.
                onMouseDown={(event) => {
                  event.preventDefault();
                  insert(person);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                  index === highlighted ? 'bg-surface-sunken' : 'hover:bg-surface-sunken',
                )}
              >
                <Avatar name={person.displayName} src={person.photoUrl} size="xs" />
                <span className="truncate text-sm font-medium text-fg">{person.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
