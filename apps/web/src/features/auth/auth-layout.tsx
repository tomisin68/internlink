import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Quote, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Logo } from '@/components/ui/logo';

interface AuthLayoutProps {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

const PROOF_POINTS = [
  { icon: Users, label: 'Verified companies only', detail: 'Every employer is CAC-checked before a role goes live.' },
  { icon: Sparkles, label: 'Matched, not spammed', detail: 'Roles ranked against your actual skills and availability.' },
  { icon: ShieldCheck, label: 'No pay-to-play, ever', detail: 'Asking a candidate for money gets an account removed.' },
];

/**
 * Two-column shell for every unauthenticated screen.
 *
 * The left panel is `hidden lg:flex` rather than reflowed onto mobile: on a
 * phone the form is the whole job, and pushing three proof points above it just
 * means more scrolling before anyone can type. Trust signals matter most on
 * desktop, where there is room to read them for free.
 */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* ---------------------------------------------------------- brand -- */}
      <aside className="relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden bg-[var(--color-violet-950)] p-12 lg:flex xl:p-14">
        {/* Aurora wash. Fixed, not animated — a looping gradient behind a login
            form is movement with nothing to say. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -right-32 size-[34rem] rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(143_109_250/0.55),transparent_65%)] blur-3xl" />
          <div className="absolute -bottom-48 -left-24 size-[30rem] rounded-full bg-[radial-gradient(circle_at_60%_40%,rgb(255_107_91/0.30),transparent_62%)] blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_35%,rgb(36_21_83/0.55))]" />
        </div>

        <div className="relative z-10">
          <Link to="/" className="inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
            <Logo className="[&_span]:text-white [&_span_span]:text-[var(--color-violet-300)]" />
          </Link>
        </div>

        <div className="relative z-10">
          <motion.h2
            initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.05, 0.7, 0.1, 1] }}
            className="max-w-md text-3xl leading-tight font-bold text-white xl:text-4xl"
          >
            Where Nigeria&rsquo;s next generation of talent gets found.
          </motion.h2>

          <ul className="mt-10 flex flex-col gap-5">
            {PROOF_POINTS.map((point, i) => (
              <motion.li
                key={point.label}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.36, delay: 0.08 + i * 0.07, ease: [0.05, 0.7, 0.1, 1] }}
                className="flex items-start gap-3.5"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/12 text-[var(--color-violet-200)] ring-1 ring-white/15">
                  <point.icon aria-hidden="true" className="size-4.5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{point.label}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-[var(--color-violet-200)]/75">
                    {point.detail}
                  </span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>

        <figure className="relative z-10 rounded-2xl border border-white/12 bg-white/6 p-5 backdrop-blur-sm">
          <Quote aria-hidden="true" className="size-5 text-[var(--color-violet-300)]" />
          <blockquote className="mt-2.5 text-sm leading-relaxed text-white/85">
            Three interviews in my first fortnight, and every one of them was a role I could
            actually do. That had not happened anywhere else.
          </blockquote>
          <figcaption className="mt-3 text-xs text-[var(--color-violet-200)]/70">
            Product design intern · Lagos
          </figcaption>
        </figure>
      </aside>

      {/* ----------------------------------------------------------- form -- */}
      <main className="flex flex-1 flex-col safe-x">
        <div className="flex items-center justify-between px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] lg:hidden">
          <Link to="/" className="inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
            <Logo />
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.05, 0.7, 0.1, 1] }}
            className="w-full max-w-[26rem]"
          >
            <header className="mb-7">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{subtitle}</p>
            </header>

            {children}

            {footer && <div className="mt-7">{footer}</div>}
          </motion.div>
        </div>
      </main>
    </div>
  );
}

/** Google's mark, drawn rather than fetched so it survives the CSP and offline. */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3a7.2 7.2 0 0 1-10.73-3.78H1.34v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.34 14.3a7.19 7.19 0 0 1 0-4.6V6.62H1.34a12 12 0 0 0 0 10.77l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.34 6.62l4 3.09A7.15 7.15 0 0 1 12 4.75Z"
      />
    </svg>
  );
}
