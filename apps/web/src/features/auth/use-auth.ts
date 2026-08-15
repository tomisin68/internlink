import { useCallback, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionPayload } from '@internlink/shared-types';
import { applyPersistence, auth, googleProvider, isFirebaseConfigured } from '@/lib/firebase';
import { useSessionStore } from '@/lib/stores';
import { authApi } from './auth-api';

/**
 * Boots the session exactly once and keeps it in step with Firebase.
 *
 * The ordering matters: Firebase resolves its persisted credential
 * asynchronously, so until `onAuthStateChanged` fires the first time we cannot
 * distinguish "signed out" from "not checked yet". Route guards read `status`
 * and must wait on `initialising`, otherwise a hard refresh on a protected page
 * bounces the user to sign-in before the credential has loaded.
 */
export function useSessionBootstrap(): void {
  const { setSession, clear, setStatus } = useSessionStore();

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setStatus('anonymous');
      return;
    }

    const unsubscribe = onAuthStateChanged(auth(), async (user) => {
      if (!user) {
        clear();
        return;
      }
      try {
        setSession(await authApi.exchangeSession());
      } catch {
        // The credential is valid but our API rejected it (suspended account,
        // API down). Treat as signed out rather than leaving the app wedged in
        // `initialising` forever.
        clear();
      }
    });

    return unsubscribe;
  }, [setSession, clear, setStatus]);
}

export function useSession() {
  const session = useSessionStore((s) => s.session);
  const status = useSessionStore((s) => s.status);

  return {
    session,
    account: session?.account ?? null,
    internProfile: session?.internProfile ?? null,
    recruiterProfile: session?.recruiterProfile ?? null,
    company: session?.company ?? null,
    nextStep: session?.nextStep ?? null,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'initialising',
  };
}

export function useSignUp() {
  const setSession = useSessionStore((s) => s.setSession);

  return useMutation({
    mutationFn: async (input: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
    }): Promise<SessionPayload> => {
      await applyPersistence(true);
      const credential = await createUserWithEmailAndPassword(auth(), input.email, input.password);

      try {
        // Set displayName on the Firebase user too, so anything reading the
        // provider record directly (admin console, exports) sees a real name.
        const displayName = `${input.firstName} ${input.lastName}`.trim();
        await updateProfile(credential.user, { displayName });

        // Fire-and-forget: a failed verification email must not block sign-up.
        // Verification is advisory at this stage, not a gate.
        void sendEmailVerification(credential.user).catch(() => undefined);

        return await authApi.exchangeSession({
          firstName: input.firstName,
          lastName: input.lastName,
        });
      } catch (error) {
        // Firebase Auth is created before the API account mirror. If the API is
        // unreachable, roll that fresh Auth user back so a retry does not hit
        // "email already in use" for an account the app never finished.
        await deleteUser(credential.user).catch(async () => {
          await signOut(auth()).catch(() => undefined);
        });
        throw error;
      }
    },
    onSuccess: setSession,
  });
}

export function useSignIn() {
  const setSession = useSessionStore((s) => s.setSession);

  return useMutation({
    mutationFn: async (input: { email: string; password: string; rememberMe: boolean }) => {
      await applyPersistence(input.rememberMe);
      await signInWithEmailAndPassword(auth(), input.email, input.password);
      return authApi.exchangeSession();
    },
    onSuccess: setSession,
  });
}

export function useGoogleSignIn() {
  const setSession = useSessionStore((s) => s.setSession);

  return useMutation({
    mutationFn: async () => {
      await applyPersistence(true);
      await signInWithPopup(auth(), googleProvider);
      // No names passed: the backend splits the provider's displayName, and the
      // profile step shows the split back for correction.
      return authApi.exchangeSession();
    },
    onSuccess: setSession,
  });
}

export function usePasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      await sendPasswordResetEmail(auth(), email);
    },
  });
}

export function useSignOut() {
  const clear = useSessionStore((s) => s.clear);
  const queryClient = useQueryClient();

  return useCallback(async () => {
    try {
      await signOut(auth());
    } finally {
      clear();
      // Wipe cached queries — the next account to sign in on this device must
      // not see the previous one's applications flash on screen.
      queryClient.clear();
    }
  }, [clear, queryClient]);
}

/** FR-104 — grants the role and lands the user on the matching wizard. */
export function useSelectRole() {
  const setSession = useSessionStore((s) => s.setSession);

  return useMutation({
    mutationFn: async (role: 'intern' | 'recruiter') => {
      const session = await authApi.selectRole(role);
      // The `active_role` claim only appears on a freshly minted token; without
      // this refresh the very next request still carries the old role.
      await auth().currentUser?.getIdToken(true);
      return session;
    },
    onSuccess: setSession,
  });
}

/** FR-103 — switch without re-authenticating. */
export function useSwitchRole() {
  const setSession = useSessionStore((s) => s.setSession);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (role: 'intern' | 'recruiter' | 'admin') => {
      const session = await authApi.switchRole(role);
      await auth().currentUser?.getIdToken(true);
      return session;
    },
    onSuccess: (session) => {
      setSession(session);
      // Every list in the app is role-scoped, so none of it survives a switch.
      queryClient.invalidateQueries();
    },
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: async () => {
      const user = auth().currentUser;
      if (!user) throw new Error('You are not signed in.');
      await sendEmailVerification(user);
    },
  });
}
