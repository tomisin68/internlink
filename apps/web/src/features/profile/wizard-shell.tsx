import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { Stepper, type Step } from '@/components/ui/stepper';
import { Button } from '@/components/ui/button';

interface WizardShellProps {
  steps: Step[];
  current: number;
  direction: 1 | -1;
  title: string;
  description: string;
  children: ReactNode;
  onBack?: (() => void) | undefined;
  onStepClick?: ((index: number) => void) | undefined;
  /** Rendered in the sticky footer — Back / Continue / Skip. */
  actions: ReactNode;
  /** Optional slot beside the header, e.g. the completeness ring. */
  aside?: ReactNode;
}

/**
 * Chrome shared by both profile wizards.
 *
 * The footer is sticky rather than sitting at the end of the document: on a
 * phone, a long step (skills, about) would otherwise push "Continue" below the
 * fold, and a primary action you have to scroll to find is a primary action
 * people miss.
 */
export function WizardShell({
  steps,
  current,
  direction,
  title,
  description,
  children,
  onBack,
  onStepClick,
  actions,
  aside,
}: WizardShellProps) {
  const prefersReducedMotion = useReducedMotion();

  const variants = prefersReducedMotion
    ? { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
      };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas safe-x">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-5 pt-[calc(0.875rem+env(safe-area-inset-top))] pb-3.5 sm:px-8">
          {onBack ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              leftIcon={<ArrowLeft />}
              className="-ml-2"
            >
              Back
            </Button>
          ) : (
            <Logo markOnly size="sm" />
          )}
          <span className="ml-auto text-sm font-medium text-fg-subtle tabular-nums">
            Step {current + 1} of {steps.length}
          </span>
        </div>

        <div className="mx-auto w-full max-w-2xl px-5 pb-5 sm:px-8">
          <Stepper steps={steps} current={current} onStepClick={onStepClick} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8 sm:px-8">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted text-pretty">{description}</p>
          </div>
          {aside}
        </div>

        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={current}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: prefersReducedMotion ? 0.14 : 0.26, ease: [0.2, 0, 0, 1] }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="sticky bottom-0 border-t border-border-subtle bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-8">
          {actions}
        </div>
      </footer>
    </div>
  );
}
