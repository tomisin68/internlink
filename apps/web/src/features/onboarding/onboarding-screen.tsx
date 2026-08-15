import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { useOnboardingStore } from '@/lib/stores';
import { cn } from '@/lib/cn';
import { MatchIllustration, NetworkIllustration, PipelineIllustration } from './illustrations';

interface Slide {
  id: string;
  eyebrow: string;
  title: string;
  highlight: string;
  body: string;
  Illustration: (props: { className?: string }) => ReactElement;
}

const SLIDES: Slide[] = [
  {
    id: 'match',
    eyebrow: 'For interns',
    title: 'Roles that actually',
    highlight: 'fit your skills',
    body: 'Tell us what you can do and where you want to go. We surface the internships worth your time — and skip the ones that were never going to reply.',
    Illustration: MatchIllustration,
  },
  {
    id: 'pipeline',
    eyebrow: 'For recruiters',
    title: 'Hire without the',
    highlight: 'inbox chaos',
    body: 'Post a role, watch candidates land in a pipeline you can actually move people through. Every status change tells them where they stand, automatically.',
    Illustration: PipelineIllustration,
  },
  {
    id: 'network',
    eyebrow: 'For everyone',
    title: 'Build the network',
    highlight: 'behind the job',
    body: 'Connect with people in your field, follow companies you admire, and collect the endorsements that make your profile speak before you do.',
    Illustration: NetworkIllustration,
  },
];

const SWIPE_CONFIDENCE_THRESHOLD = 8_000;

/**
 * Onboarding carousel — the first screen a new device ever sees.
 *
 * Two UX rules drive the shape of this: progress must be visible (the dots
 * double as a step indicator) and it must be skippable (FR "User Freedom" —
 * a locked, unskippable tour is an anti-pattern). Skip is present on every
 * slide, at full size, not hidden in a corner at 11px.
 */
export function OnboardingScreen() {
  const navigate = useNavigate();
  const markIntroSeen = useOnboardingStore((s) => s.markIntroSeen);
  const prefersReducedMotion = useReducedMotion();

  const [[index, direction], setPage] = useState<[number, number]>([0, 0]);
  const liveRegionRef = useRef<HTMLParagraphElement>(null);

  const finish = useCallback(() => {
    markIntroSeen();
    navigate('/sign-up', { replace: true });
  }, [markIntroSeen, navigate]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) return;
      if (next >= SLIDES.length) {
        finish();
        return;
      }
      setPage(([current]) => [next, next > current ? 1 : -1]);
    },
    [finish],
  );

  // Arrow keys move between slides — the carousel is focusable, so a keyboard
  // user should not have to tab to a dot to advance.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') goTo(index + 1);
      if (event.key === 'ArrowLeft') goTo(index - 1);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, goTo]);

  const slide = SLIDES[index]!;
  const isLast = index === SLIDES.length - 1;

  // Reduced motion gets a cross-fade instead of a slide: the information is
  // identical, only the vestibular cost differs.
  const variants = prefersReducedMotion
    ? {
        enter: { opacity: 0 },
        center: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        enter: (dir: number) => ({ x: dir > 0 ? 64 : -64, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (dir: number) => ({ x: dir > 0 ? -64 : 64, opacity: 0 }),
      };

  function handleDragEnd(_event: unknown, info: PanInfo): void {
    const power = info.offset.x * info.velocity.x;
    if (power < -SWIPE_CONFIDENCE_THRESHOLD) goTo(index + 1);
    else if (power > SWIPE_CONFIDENCE_THRESHOLD) goTo(index - 1);
  }

  return (
    <div className="aurora-field flex min-h-dvh flex-col bg-canvas safe-x">
      <header className="flex items-center justify-between px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-8">
        <Logo />
        <Button variant="ghost" size="sm" onClick={finish}>
          Skip
        </Button>
      </header>

      <main
        className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-8"
        // A roledescription tells AT this is a carousel without us having to
        // build full APG carousel semantics for a three-slide intro.
        role="group"
        aria-roledescription="carousel"
        aria-label="What InternLink does"
      >
        <p ref={liveRegionRef} className="sr-only" aria-live="polite">
          Slide {index + 1} of {SLIDES.length}: {slide.title} {slide.highlight}
        </p>

        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.section
            key={slide.id}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: prefersReducedMotion ? 0.16 : 0.32, ease: [0.2, 0, 0, 1] }}
            drag={prefersReducedMotion ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={handleDragEnd}
            className="flex w-full cursor-grab flex-col items-center text-center active:cursor-grabbing"
          >
            <slide.Illustration className="mb-8 h-52 w-full max-w-sm sm:h-60" />

            <span className="mb-3 inline-flex items-center rounded-full border border-brand-border bg-brand-subtle px-3 py-1 text-xs font-semibold tracking-wide text-brand-fg uppercase">
              {slide.eyebrow}
            </span>

            <h1 className="text-3xl leading-tight font-bold text-balance sm:text-4xl">
              {slide.title} <span className="text-gradient">{slide.highlight}</span>
            </h1>

            <p className="mt-4 max-w-md text-base leading-relaxed text-fg-muted text-pretty">
              {slide.body}
            </p>
          </motion.section>
        </AnimatePresence>
      </main>

      <footer className="mx-auto w-full max-w-lg px-6 pb-[calc(1.75rem+env(safe-area-inset-bottom))]">
        <div className="mb-6 flex items-center justify-center gap-2">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}: ${s.title} ${s.highlight}`}
              aria-current={i === index ? 'true' : undefined}
              className="group flex h-11 cursor-pointer items-center px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <span
                className={cn(
                  'block h-2 rounded-full transition-[width,background-color] duration-[280ms] ease-[cubic-bezier(0.2,0,0,1)]',
                  i === index
                    ? 'w-7 bg-brand'
                    : 'w-2 bg-border-strong group-hover:bg-fg-faint',
                )}
              />
            </button>
          ))}
        </div>

        <Button size="lg" fullWidth onClick={() => goTo(index + 1)} rightIcon={<ArrowRight />}>
          {isLast ? 'Create your account' : 'Next'}
        </Button>

        <p className="mt-4 text-center text-sm text-fg-muted">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => {
              markIntroSeen();
              navigate('/sign-in');
            }}
            className="cursor-pointer font-semibold text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Sign in
          </button>
        </p>
      </footer>
    </div>
  );
}
