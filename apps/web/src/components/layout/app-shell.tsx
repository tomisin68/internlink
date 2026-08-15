import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Briefcase,
  Compass,
  Home,
  MessageSquare,
  Repeat,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  notificationKeys,
  notificationsApi,
} from '@/features/notifications/notifications-screen';
import { Logo } from '@/components/ui/logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { messagingApi, queryKeys } from '@/lib/api-endpoints';
import { useSession, useSignOut, useSwitchRole } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  /** Unread count rendered as a badge. */
  badge?: number;
}

/**
 * Bottom bar on mobile, rail on desktop.
 *
 * Capped at five destinations per the bottom-nav rule — a sixth turns the bar
 * into a guessing game at 375px. Anything else lives behind the avatar menu.
 */
function useNavItems(unread: number, isIntern: boolean): NavItem[] {
  return [
    { to: '/home', label: 'Home', icon: Home },
    isIntern
      ? { to: '/matches', label: 'Matches', icon: Sparkles }
      : { to: '/roles', label: 'Roles', icon: Briefcase },
    { to: '/feed', label: 'Feed', icon: Compass },
    { to: '/messages', label: 'Messages', icon: MessageSquare, badge: unread },
    { to: '/network', label: 'Network', icon: Users },
  ];
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -top-0.5 -right-1.5 min-w-4.5 rounded-full bg-accent px-1 text-center text-2xs font-bold text-white tabular-nums"
      aria-label={`${count} unread`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { account, company } = useSession();
  const navigate = useNavigate();
  const switchRole = useSwitchRole();
  const signOut = useSignOut();

  const { data: summary } = useQuery({
    queryKey: queryKeys.inboxSummary,
    queryFn: messagingApi.summary,
    // Cheap enough to poll, and an inbox badge that lags by a minute is the
    // kind of small wrongness people notice immediately.
    refetchInterval: 45_000,
    enabled: Boolean(account),
  });

  const { data: notifications } = useQuery({
    queryKey: notificationKeys.unread,
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 60_000,
    enabled: Boolean(account),
  });

  const isIntern = account?.activeRole === 'intern';
  const unread = (summary?.unreadThreads ?? 0) + (summary?.pendingRequests ?? 0);
  const notificationCount = notifications?.count ?? 0;
  const items = useNavItems(unread, isIntern);

  if (!account) return null;

  const otherRole = isIntern ? 'recruiter' : 'intern';
  const holdsOtherRole = account.roles.includes(otherRole);

  async function handleSwitch(): Promise<void> {
    if (!holdsOtherRole) {
      navigate('/onboarding/role');
      return;
    }
    try {
      await switchRole.mutateAsync(otherRole);
      toast.success(`Switched to ${otherRole}`);
    } catch {
      toast.error('Could not switch', 'Try again in a moment.');
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      {/* ------------------------------------------------------- top bar -- */}
      <header className="sticky top-0 z-20 border-b border-border-subtle bg-surface/85 backdrop-blur-md safe-x">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] sm:px-6">
          <NavLink
            to="/home"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <Logo size="sm" />
          </NavLink>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSwitch}
              isLoading={switchRole.isPending}
              leftIcon={<Repeat />}
              title={holdsOtherRole ? `Switch to ${otherRole}` : `Set up your ${otherRole} profile`}
            >
              <span className="hidden md:inline">
                {holdsOtherRole ? `Switch to ${otherRole}` : `Add ${otherRole}`}
              </span>
              <span className="md:hidden">{isIntern ? 'Intern' : 'Recruiter'}</span>
            </Button>

            <NavLink
              to="/notifications"
              aria-label={
                notificationCount > 0
                  ? `Notifications, ${notificationCount} unread`
                  : 'Notifications'
              }
              className={({ isActive }) =>
                cn(
                  'relative flex size-9 items-center justify-center rounded-lg transition-colors duration-[160ms]',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  isActive ? 'bg-brand-subtle text-brand-fg' : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
                )
              }
            >
              <Bell aria-hidden="true" className="size-5" />
              <Badge count={notificationCount} />
            </NavLink>

            <NavLink
              to="/profile"
              className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              aria-label="Your profile"
            >
              <Avatar
                name={account.displayName}
                src={account.photoUrl}
                size="sm"
                verified={account.verificationTiers.length > 0}
              />
            </NavLink>

            <Button variant="ghost" size="sm" onClick={() => void signOut()} className="hidden sm:inline-flex">
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl gap-6 px-0 sm:px-6">
        {/* ------------------------------------------------- desktop rail -- */}
        <nav
          aria-label="Main"
          className="sticky top-[4.25rem] hidden h-fit w-56 shrink-0 flex-col gap-1 py-6 lg:flex"
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors duration-[160ms]',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  isActive
                    ? 'bg-brand-subtle text-brand-fg'
                    : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
                )
              }
            >
              <span className="relative">
                <item.icon aria-hidden="true" className="size-5" />
                <Badge count={item.badge ?? 0} />
              </span>
              {item.label}
            </NavLink>
          ))}

          {!isIntern && company && (
            <div className="mt-6 rounded-xl border border-border-default bg-surface p-3.5">
              <div className="flex items-center gap-2.5">
                <Avatar
                  name={company.name}
                  src={company.logoUrl}
                  size="sm"
                  shape="rounded"
                  verified={company.verificationStatus === 'verified'}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg">{company.name}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {company.verificationStatus === 'verified' ? 'Verified' : 'Verification pending'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </nav>

        {/* ------------------------------------------------------ content -- */}
        <main
          id="app-content"
          className="min-w-0 flex-1 pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-10"
        >
          {children ?? <Outlet />}
        </main>
      </div>

      {/* ---------------------------------------------------- bottom nav -- */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border-subtle bg-surface/92 backdrop-blur-md pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="flex items-stretch">
          {items.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    // 56px tall — comfortably past the 44px touch-target floor
                    // even with the label underneath.
                    'flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors duration-[160ms]',
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
                    isActive ? 'text-brand-fg' : 'text-fg-subtle',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <item.icon
                        aria-hidden="true"
                        className="size-5.5"
                        strokeWidth={isActive ? 2.4 : 1.9}
                      />
                      <Badge count={item.badge ?? 0} />
                    </span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
