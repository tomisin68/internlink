import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionPayload } from '@internlink/shared-types';

/* ============================================================== session ==== */

type SessionStatus = 'initialising' | 'authenticated' | 'anonymous';

interface SessionState {
  status: SessionStatus;
  session: SessionPayload | null;
  setSession: (session: SessionPayload) => void;
  clear: () => void;
  setStatus: (status: SessionStatus) => void;
}

/**
 * Not persisted, on purpose.
 *
 * Firebase already persists the credential; rehydrating a stale account
 * snapshot from localStorage means a user who was verified on another device
 * sees the old state until the first fetch lands. The session is always
 * re-derived from `/auth/me` at boot instead.
 */
export const useSessionStore = create<SessionState>((set) => ({
  status: 'initialising',
  session: null,
  setSession: (session) => set({ session, status: 'authenticated' }),
  clear: () => set({ session: null, status: 'anonymous' }),
  setStatus: (status) => set({ status }),
}));

/* ================================================================ theme ==== */

type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

function applyTheme(preference: ThemePreference): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = preference === 'dark' || (preference === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => {
        applyTheme(preference);
        set({ preference });
      },
    }),
    {
      name: 'internlink.theme.store',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.preference);
      },
    },
  ),
);

/** Keeps `system` honest when the OS theme flips while the app is open. */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (useThemeStore.getState().preference === 'system') applyTheme('system');
  };
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}

/* ============================================================ onboarding === */

interface OnboardingState {
  /** Whether the marketing carousel has been seen. Separate from account state:
   *  it is device-local and applies before anyone has signed in. */
  hasSeenIntro: boolean;
  markIntroSeen: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      hasSeenIntro: false,
      markIntroSeen: () => set({ hasSeenIntro: true }),
    }),
    { name: 'internlink.onboarding' },
  ),
);

/* ================================================================ toasts === */

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: 'default' | 'success' | 'error' | 'warning';
  /** ms; 0 means the toast stays until dismissed. */
  duration: number;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration' | 'variant'> & Partial<Pick<Toast, 'duration' | 'variant'>>) => string;
  dismiss: (id: string) => void;
}

let toastSeq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = `toast_${++toastSeq}`;
    const full: Toast = {
      variant: 'default',
      // Errors stay longer — they usually carry an instruction to act on.
      duration: toast.variant === 'error' ? 7000 : 4500,
      ...toast,
      id,
    };
    set((state) => ({ toasts: [...state.toasts, full] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'success' }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'error' }),
  warning: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'warning' }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description }),
};
