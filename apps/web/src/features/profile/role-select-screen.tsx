import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Briefcase, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OptionCard } from '@/components/ui/option-card';
import { Alert } from '@/components/ui/feedback';
import { Logo } from '@/components/ui/logo';
import { cn } from '@/lib/cn';
import { useSelectRole, useSession } from '@/features/auth/use-auth';

type Choice = 'intern' | 'recruiter';

const OPTIONS: Array<{
  role: Choice;
  title: string;
  description: string;
  icon: typeof GraduationCap;
  bullets: string[];
}> = [
  {
    role: 'intern',
    title: "I'm looking for a role",
    description: 'Student or early-career, hunting for an internship or first job.',
    icon: GraduationCap,
    bullets: ['Get matched to roles that fit', 'Apply in one tap with your CV', 'Track every application'],
  },
  {
    role: 'recruiter',
    title: "I'm hiring",
    description: 'Posting internships and entry-level roles for a company.',
    icon: Briefcase,
    bullets: ['Post roles once, reach everyone', 'Move candidates through a pipeline', 'Build a talent pool'],
  },
];

/**
 * FR-104 — the fork in the road immediately after sign-up.
 *
 * Framed as "what do you want to do first", not "what are you", because an
 * account can hold both profiles (FR-102) and this choice is reversible. The
 * reassurance line under the button carries that, so nobody stalls here
 * worrying they are picking permanently.
 */
export function RoleSelectScreen() {
  const navigate = useNavigate();
  const { account } = useSession();
  const selectRole = useSelectRole();
  const prefersReducedMotion = useReducedMotion();

  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Continue is always pressable, and says what is missing when it is pressed.
   *
   * A greyed-out button gives no reason and no feedback: on touch there is no
   * hover to reveal a tooltip, the press does nothing at all, and people read
   * that as the app being broken rather than as "pick one first". Letting the
   * press through and answering it is both more accessible and less confusing —
   * `aria-disabled` still tells assistive tech the action is not ready.
   */
  async function handleContinue(): Promise<void> {
    if (!choice) {
      setError('Pick one of the two above to continue — you can add the other later.');
      return;
    }
    setError(null);
    try {
      await selectRole.mutateAsync(choice);
      navigate(choice === 'intern' ? '/onboarding/profile' : '/onboarding/company', {
        replace: true,
      });
    } catch {
      setError('We could not save that. Check your connection and try again.');
    }
  }

  const firstName = account?.firstName?.trim();

  return (
    <div className="aurora-field flex min-h-dvh flex-col bg-canvas safe-x">
      <header className="px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] sm:px-10">
        <Logo />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-10">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: [0.05, 0.7, 0.1, 1] }}
        >
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            {firstName ? `Welcome, ${firstName}.` : 'Welcome.'}{' '}
            <span className="text-gradient">What brings you here?</span>
          </h1>
          <p className="mt-3 max-w-lg text-base leading-relaxed text-fg-muted">
            This sets up your first profile. You can add the other one whenever you like — one
            account covers both.
          </p>
        </motion.div>

        <div className="mt-9 grid gap-4 sm:grid-cols-2">
          {OPTIONS.map((option, index) => (
            <motion.div
              key={option.role}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, delay: 0.06 + index * 0.08, ease: [0.05, 0.7, 0.1, 1] }}
            >
              <OptionCard
                name="role"
                selected={choice === option.role}
                onSelect={() => setChoice(option.role)}
                title={option.title}
                description={option.description}
                icon={<option.icon />}
                className="h-full flex-col items-start gap-4 p-5"
              />
              <ul className="mt-3 flex flex-col gap-1.5 px-1">
                {option.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2 text-sm text-fg-muted">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"
                    />
                    {bullet}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {error && (
          <Alert variant="error" className="mt-6">
            {error}
          </Alert>
        )}

        <div className="mt-9">
          <Button
            size="lg"
            fullWidth
            aria-disabled={!choice}
            isLoading={selectRole.isPending}
            loadingText="Setting things up…"
            onClick={handleContinue}
            rightIcon={<ArrowRight />}
            // Dimmed to show it is not ready, but still a real button — see
            // `handleContinue` for why it is not `disabled`.
            className={cn('sm:w-auto sm:min-w-56', !choice && 'opacity-60')}
          >
            Continue
          </Button>
          <p className="mt-3 text-sm text-fg-subtle">
            You can switch between intern and recruiter at any time from your profile menu.
          </p>
        </div>
      </main>
    </div>
  );
}
