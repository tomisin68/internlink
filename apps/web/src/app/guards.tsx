import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { SessionPayload } from '@internlink/shared-types';
import { LoadingScreen } from '@/components/ui/feedback';
import { useSession } from '@/features/auth/use-auth';
import { useOnboardingStore } from '@/lib/stores';

/**
 * Where a given `nextStep` should send the user. Single source of truth.
 *
 * `verify_email` maps to /home rather than to a verification wall: the server
 * never emits it today (verification is advisory, not a gate), and pointing it
 * at a route that does not exist would send anyone who hit it into a redirect
 * loop via the catch-all. If verification ever becomes blocking, add the screen
 * and change this one line.
 */
const STEP_ROUTE: Record<SessionPayload['nextStep'], string> = {
  select_role: '/onboarding/role',
  create_intern_profile: '/onboarding/profile',
  create_recruiter_profile: '/onboarding/company',
  verify_email: '/home',
  ready: '/home',
};

/**
 * Requires a signed-in account.
 *
 * The `isLoading` branch is load-bearing: Firebase resolves its persisted
 * credential asynchronously, so without it a hard refresh on a protected page
 * would redirect to sign-in a beat before the session arrives — the classic
 * "logged out on refresh" bug.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) return <LoadingScreen />;

  if (!isAuthenticated) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}

/**
 * Keeps a half-onboarded account out of the main app.
 *
 * Reads the server-computed `nextStep` rather than inferring from which
 * profiles exist — see auth.service.computeNextStep for why that decision
 * lives in exactly one place.
 */
export function RequireCompleteOnboarding({ children }: { children: ReactNode }) {
  const { nextStep, isLoading } = useSession();

  if (isLoading) return <LoadingScreen />;
  if (nextStep && nextStep !== 'ready') {
    return <Navigate to={STEP_ROUTE[nextStep]} replace />;
  }

  return <>{children}</>;
}

/**
 * The inverse: keeps a *finished* account out of the onboarding screens, so a
 * back-button press after finishing the wizard does not drop them into an
 * empty form.
 */
export function RequireIncompleteOnboarding({
  children,
  step,
}: {
  children: ReactNode;
  step: SessionPayload['nextStep'];
}) {
  const { nextStep, isLoading } = useSession();

  if (isLoading) return <LoadingScreen />;
  if (nextStep === 'ready') return <Navigate to="/home" replace />;
  // Landed on the wrong wizard for their current state — send them to the right
  // one rather than letting them fill in a form that will be rejected.
  if (nextStep && nextStep !== step) return <Navigate to={STEP_ROUTE[nextStep]} replace />;

  return <>{children}</>;
}

/** Signed-in users should never see sign-in/sign-up again. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useSession();

  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/**
 * The `/` entry point. Decides where a visitor actually belongs:
 *   never seen the intro  → the carousel
 *   seen it, signed out   → sign in
 *   signed in, mid-setup  → the right wizard step
 *   signed in, done       → home
 */
export function RootRoute() {
  const { isAuthenticated, isLoading, nextStep } = useSession();
  const hasSeenIntro = useOnboardingStore((s) => s.hasSeenIntro);

  if (isLoading) return <LoadingScreen />;

  if (!isAuthenticated) {
    return <Navigate to={hasSeenIntro ? '/sign-in' : '/welcome'} replace />;
  }

  return <Navigate to={nextStep ? STEP_ROUTE[nextStep] : '/home'} replace />;
}
