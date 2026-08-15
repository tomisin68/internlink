import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ============================================================================
   Field wiring
   ----------------------------------------------------------------------------
   `Field` owns the IDs and the aria-* relationships so no individual form has
   to remember them. Every input gets:
     • a real <label for>            (never a placeholder standing in for one)
     • aria-describedby → hint       (so the hint is announced, not just seen)
     • aria-errormessage + invalid   (so the error is announced on failure)
   ============================================================================ */

interface FieldContextValue {
  inputId: string;
  hintId: string;
  errorId: string;
  hasError: boolean;
  isDisabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldContext(component: string): FieldContextValue {
  const context = useContext(FieldContext);
  if (!context) {
    throw new Error(`<${component}> must be rendered inside a <Field>.`);
  }
  return context;
}

export interface FieldProps {
  label: string;
  /** Persistent helper text. Shown above the error, never replaced by it. */
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  disabled?: boolean;
  /** Right-aligned slot on the label row — "Forgot password?", char counters. */
  labelAccessory?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  labelAccessory,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const value: FieldContextValue = {
    inputId: `${id}-input`,
    hintId: `${id}-hint`,
    errorId: `${id}-error`,
    hasError: Boolean(error),
    isDisabled: disabled,
  };

  return (
    <FieldContext.Provider value={value}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label
            htmlFor={value.inputId}
            className={cn(
              'text-sm font-medium text-fg',
              disabled && 'text-fg-faint',
            )}
          >
            {label}
            {required && (
              <>
                <span aria-hidden="true" className="ml-0.5 text-accent-fg">
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </>
            )}
          </label>
          {labelAccessory}
        </div>

        {children}

        {hint && !error && (
          <p id={value.hintId} className="text-xs text-fg-subtle">
            {hint}
          </p>
        )}

        {/* role="alert" so the message is announced the moment it appears —
            validation on blur is useless to a screen reader otherwise. */}
        {error && (
          <p
            id={value.errorId}
            role="alert"
            className="flex items-start gap-1.5 text-xs font-medium text-danger-fg"
          >
            <AlertCircle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/* ================================================================= Input === */

const controlBase = cn(
  'w-full rounded-xl border bg-surface text-fg placeholder:text-fg-faint',
  'transition-[border-color,box-shadow,background-color] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]',
  'focus:outline-none focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-faint',
);

const controlState = (hasError: boolean) =>
  hasError
    ? 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_18%,transparent)]'
    : 'border-border-default hover:border-border-strong focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)]';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leftIcon, rightSlot, ...props },
  ref,
) {
  const field = useFieldContext('Input');

  return (
    <div className="relative">
      {leftIcon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-faint [&>svg]:size-4.5"
        >
          {leftIcon}
        </span>
      )}
      <input
        ref={ref}
        id={field.inputId}
        disabled={field.isDisabled || props.disabled}
        aria-invalid={field.hasError || undefined}
        aria-errormessage={field.hasError ? field.errorId : undefined}
        aria-describedby={!field.hasError ? field.hintId : undefined}
        className={cn(
          controlBase,
          controlState(field.hasError),
          // 44px tall — the touch-target floor.
          'h-11 px-3.5 text-base',
          leftIcon && 'pl-10.5',
          rightSlot && 'pr-11',
          className,
        )}
        {...props}
      />
      {rightSlot && (
        <div className="absolute top-1/2 right-1.5 -translate-y-1/2">{rightSlot}</div>
      )}
    </div>
  );
});

/* ============================================================== Textarea === */

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 4, ...props },
  ref,
) {
  const field = useFieldContext('Textarea');

  return (
    <textarea
      ref={ref}
      id={field.inputId}
      rows={rows}
      disabled={field.isDisabled || props.disabled}
      aria-invalid={field.hasError || undefined}
      aria-errormessage={field.hasError ? field.errorId : undefined}
      aria-describedby={!field.hasError ? field.hintId : undefined}
      className={cn(controlBase, controlState(field.hasError), 'resize-y px-3.5 py-3 text-base', className)}
      {...props}
    />
  );
});

/* ================================================================ Select === */

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...props },
  ref,
) {
  const field = useFieldContext('Select');

  return (
    <div className="relative">
      <select
        ref={ref}
        id={field.inputId}
        disabled={field.isDisabled || props.disabled}
        aria-invalid={field.hasError || undefined}
        aria-errormessage={field.hasError ? field.errorId : undefined}
        aria-describedby={!field.hasError ? field.hintId : undefined}
        className={cn(
          controlBase,
          controlState(field.hasError),
          'h-11 cursor-pointer appearance-none px-3.5 pr-10 text-base',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-fg-subtle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

/* ============================================================== Checkbox === */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  error?: string | undefined;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, className, ...props },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      {/* The whole row is the label, so the tap target is the text too — not
          just the 20px box. */}
      <label
        htmlFor={id}
        className={cn(
          'group flex cursor-pointer items-start gap-3 text-sm text-fg-muted select-none',
          props.disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        <span className="relative mt-px flex size-5 shrink-0 items-center justify-center">
          <input
            ref={ref}
            id={id}
            type="checkbox"
            aria-invalid={Boolean(error) || undefined}
            aria-errormessage={error ? errorId : undefined}
            className="peer size-5 cursor-pointer appearance-none rounded-md border border-border-strong bg-surface transition-colors duration-[160ms] checked:border-brand checked:bg-brand hover:border-fg-faint checked:hover:bg-brand-hover disabled:cursor-not-allowed aria-[invalid]:border-danger"
            {...props}
          />
          <Check
            aria-hidden="true"
            className="pointer-events-none absolute size-3.5 scale-75 text-white opacity-0 transition-[opacity,transform] duration-[160ms] peer-checked:scale-100 peer-checked:opacity-100"
            strokeWidth={3}
          />
        </span>
        <span className="pt-0.5 leading-snug">{label}</span>
      </label>

      {error && (
        <p id={errorId} role="alert" className="ml-8 text-xs font-medium text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
});
