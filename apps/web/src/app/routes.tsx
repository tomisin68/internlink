import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingScreen } from '@/components/ui/feedback';
import {
  RedirectIfAuthenticated,
  RequireAuth,
  RequireCompleteOnboarding,
  RequireIncompleteOnboarding,
  RootRoute,
} from './guards';

/**
 * Route-level code splitting.
 *
 * The onboarding carousel and the auth screens are what a cold visitor loads,
 * so they stay eager — a suspense flash on the very first paint is exactly the
 * wrong place to save 12kB. Everything behind the sign-in wall is lazy.
 */
import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';
import { SignInScreen } from '@/features/auth/sign-in-screen';
import { SignUpScreen } from '@/features/auth/sign-up-screen';

const ForgotPasswordScreen = lazy(() =>
  import('@/features/auth/forgot-password-screen').then((m) => ({ default: m.ForgotPasswordScreen })),
);
const RoleSelectScreen = lazy(() =>
  import('@/features/profile/role-select-screen').then((m) => ({ default: m.RoleSelectScreen })),
);
const InternProfileWizard = lazy(() =>
  import('@/features/profile/intern-wizard').then((m) => ({ default: m.InternProfileWizard })),
);
const RecruiterProfileWizard = lazy(() =>
  import('@/features/profile/recruiter-wizard').then((m) => ({ default: m.RecruiterProfileWizard })),
);
const HomeScreen = lazy(() => import('./home-screen').then((m) => ({ default: m.HomeScreen })));
const AppShell = lazy(() =>
  import('@/components/layout/app-shell').then((m) => ({ default: m.AppShell })),
);
const FeedScreen = lazy(() =>
  import('@/features/feed/feed-screen').then((m) => ({ default: m.FeedScreen })),
);
const MatchesScreen = lazy(() =>
  import('@/features/feed/matches-screen').then((m) => ({ default: m.MatchesScreen })),
);
const MessagesScreen = lazy(() =>
  import('@/features/messaging/messages-screen').then((m) => ({ default: m.MessagesScreen })),
);
const ThreadView = lazy(() =>
  import('@/features/messaging/thread-view').then((m) => ({ default: m.ThreadView })),
);
const ThreadPlaceholder = lazy(() =>
  import('@/features/messaging/thread-view').then((m) => ({ default: m.ThreadPlaceholder })),
);
const RolesScreen = lazy(() =>
  import('@/features/roles/roles-screen').then((m) => ({ default: m.RolesScreen })),
);
const RoleDetailScreen = lazy(() =>
  import('@/features/roles/role-detail-screen').then((m) => ({ default: m.RoleDetailScreen })),
);
const RoleComposerScreen = lazy(() =>
  import('@/features/roles/role-composer-screen').then((m) => ({ default: m.RoleComposerScreen })),
);
const ApplicationsScreen = lazy(() =>
  import('@/features/applications/applications-screen').then((m) => ({
    default: m.ApplicationsScreen,
  })),
);
const PipelineScreen = lazy(() =>
  import('@/features/applications/pipeline-screen').then((m) => ({ default: m.PipelineScreen })),
);
const NetworkScreen = lazy(() =>
  import('@/features/network/network-screen').then((m) => ({ default: m.NetworkScreen })),
);
const ProfileScreen = lazy(() =>
  import('@/features/profile/profile-screen').then((m) => ({ default: m.ProfileScreen })),
);
const PublicProfileScreen = lazy(() =>
  import('@/features/profile/public-profile-screen').then((m) => ({
    default: m.PublicProfileScreen,
  })),
);
const PostScreen = lazy(() =>
  import('@/features/feed/post-screen').then((m) => ({ default: m.PostScreen })),
);
const NotificationsScreen = lazy(() =>
  import('@/features/notifications/notifications-screen').then((m) => ({
    default: m.NotificationsScreen,
  })),
);

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<RootRoute />} />

        {/* ---------------------------------------------------- public --- */}
        <Route path="/welcome" element={<OnboardingScreen />} />

        <Route
          path="/sign-in"
          element={
            <RedirectIfAuthenticated>
              <SignInScreen />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/sign-up"
          element={
            <RedirectIfAuthenticated>
              <SignUpScreen />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <RedirectIfAuthenticated>
              <ForgotPasswordScreen />
            </RedirectIfAuthenticated>
          }
        />

        {/* ------------------------------------------------ onboarding --- */}
        <Route
          path="/onboarding/role"
          element={
            <RequireAuth>
              <RequireIncompleteOnboarding step="select_role">
                <RoleSelectScreen />
              </RequireIncompleteOnboarding>
            </RequireAuth>
          }
        />
        <Route
          path="/onboarding/profile"
          element={
            <RequireAuth>
              <RequireIncompleteOnboarding step="create_intern_profile">
                <InternProfileWizard />
              </RequireIncompleteOnboarding>
            </RequireAuth>
          }
        />
        <Route
          path="/onboarding/company"
          element={
            <RequireAuth>
              <RequireIncompleteOnboarding step="create_recruiter_profile">
                <RecruiterProfileWizard />
              </RequireIncompleteOnboarding>
            </RequireAuth>
          }
        />

        {/* -------------------------------------------------- protected --- */}
        {/* One guarded layout route rather than a guard per screen: the shell
            renders once and survives navigation, so the nav does not remount
            (and the unread badge does not flicker) on every route change. */}
        <Route
          element={
            <RequireAuth>
              <RequireCompleteOnboarding>
                <AppShell />
              </RequireCompleteOnboarding>
            </RequireAuth>
          }
        >
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/feed" element={<FeedScreen />} />
          <Route path="/matches" element={<MatchesScreen />} />
          <Route path="/messages" element={<MessagesScreen />}>
            <Route index element={<ThreadPlaceholder />} />
            <Route path=":threadId" element={<ThreadView />} />
          </Route>

          {/* `/roles/new` must precede `/roles/:id`, or "new" is read as an id. */}
          <Route path="/roles" element={<RolesScreen />} />
          <Route path="/roles/new" element={<RoleComposerScreen />} />
          <Route path="/roles/:id" element={<RoleDetailScreen />} />
          <Route path="/roles/:listingId/pipeline" element={<PipelineScreen />} />

          <Route path="/applications" element={<ApplicationsScreen />} />
          <Route path="/network" element={<NetworkScreen />} />
          <Route path="/notifications" element={<NotificationsScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          {/* Somebody else's profile. Short prefix because it is the most
              linked-to route in the app — every author name in the feed. */}
          <Route path="/u/:accountId" element={<PublicProfileScreen />} />

          {/* Post permalink — where a shared link lands. Kept short and
              version-free: people paste these into WhatsApp, so it has to keep
              working forever. On Vercel the same path is served by the API's
              share endpoint first, for the Open Graph preview. */}
          <Route path="/p/:postId" element={<PostScreen />} />
        </Route>

        {/* Unbuilt routes referenced by links elsewhere resolve to the root
            decision rather than a dead end. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
