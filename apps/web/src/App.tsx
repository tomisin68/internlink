import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from './app/routes';
import { Toaster } from './components/ui/toaster';
import { PwaUpdatePrompt } from './components/layout/pwa-update-prompt';
import { Alert } from './components/ui/feedback';
import { useSessionBootstrap } from './features/auth/use-auth';
import { watchSystemTheme } from './lib/stores';
import { ApiRequestError, NetworkError } from './lib/api-client';
import { isFirebaseConfigured } from './lib/firebase';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry(failureCount, error) {
        // Retrying a 401 or a 422 just burns the user's data allowance and
        // delays the error they need to see.
        if (error instanceof ApiRequestError && !error.isRetryable) return false;
        if (error instanceof NetworkError) return failureCount < 2;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      // Mutations are never retried automatically — a duplicate application or
      // a double profile write is worse than an error message.
      retry: false,
    },
  },
});

function AppShell() {
  useSessionBootstrap();

  useEffect(() => watchSystemTheme(), []);

  return (
    <>
      {/* Skip link — first thing in the tab order, invisible until focused. */}
      <a
        href="#main-content"
        className="sr-only-focusable top-3 left-3 z-50 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
      >
        Skip to main content
      </a>

      {!isFirebaseConfigured && (
        <div className="p-4">
          <Alert variant="warning" title="Firebase is not configured">
            Copy <code className="font-mono text-xs">apps/web/.env.example</code> to{' '}
            <code className="font-mono text-xs">.env.local</code> and fill in the{' '}
            <code className="font-mono text-xs">VITE_FIREBASE_*</code> values. Sign-in will not work
            until you do.
          </Alert>
        </div>
      )}

      <div id="main-content">
        <AppRoutes />
      </div>

      <Toaster />
      <PwaUpdatePrompt />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
