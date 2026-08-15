import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface OptionCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Renders as a checkbox rather than a radio for multi-select groups. */
  multiple?: boolean;
  name?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Large selectable card — role selection, work-mode preference, availability.
 *
 * Built on a real `input[type=radio|checkbox]` rather than a div with a click
 * handler, so arrow-key navigation within the group, form association and
 * screen-reader semantics all work without reimplementation.
 */
export function OptionCard({
  selected,
  onSelect,
  title,
  description,
  icon,
  multiple = false,
  name,
  className,
  disabled = false,
}: OptionCardProps) {
  return (
    <label
      className={cn(
        'group relative flex cursor-pointer gap-3.5 rounded-2xl border-2 p-4 text-left',
        'transition-[border-color,background-color,box-shadow,transform] duration-[200ms] ease-[cubic-bezier(0.2,0,0,1)]',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]',
        selected
          ? 'border-brand bg-brand-subtle shadow-[0_8px_28px_-10px_rgb(108_76_241_/_0.45)]'
          : 'border-border-default bg-surface hover:border-brand-border hover:bg-surface-sunken',
        disabled && 'pointer-events-none opacity-55',
        className,
      )}
    >
      <input
        type={multiple ? 'checkbox' : 'radio'}
        name={name}
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="sr-only"
      />

      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-[200ms] [&>svg]:size-5.5',
            selected
              ? 'bg-brand text-white'
              : 'bg-surface-sunken text-fg-muted group-hover:bg-brand-subtle group-hover:text-brand-fg',
          )}
        >
          {icon}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className={cn('block font-semibold', selected ? 'text-brand-fg' : 'text-fg')}>
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block text-sm leading-snug text-fg-muted">{description}</span>
        )}
      </span>

      {/* The tick is the redundant confirmation of selection — colour alone
          would fail for anyone who cannot distinguish the border change. */}
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center self-start rounded-full border-2 transition-[border-color,background-color] duration-[200ms]',
          multiple && 'rounded-md',
          selected ? 'border-brand bg-brand' : 'border-border-strong bg-transparent',
        )}
      >
        {selected && (
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 26 }}
          >
            <Check className="size-3 text-white" strokeWidth={3.5} />
          </motion.span>
        )}
      </span>
    </label>
  );
}
