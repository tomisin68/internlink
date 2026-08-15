import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase,
  Building2,
  Check,
  Eye,
  GraduationCap,
  LogOut,
  MapPin,
  Moon,
  Pencil,
  Sun,
  SunMoon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { TagInput } from '@/components/ui/tag-input';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { profileApiClient, queryKeys } from '@/lib/api-endpoints';
import { useSession, useSignOut } from '@/features/auth/use-auth';
import { toast, useThemeStore } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { CompletenessCard } from './completeness-card';
import { ProfileHeaderEditor } from './profile-header-editor';
import { NotificationSettings } from './notification-settings';
import { SKILL_SUGGESTIONS } from './constants';

export function ProfileScreen() {
  const { account, internProfile, company } = useSession();
  const signOut = useSignOut();
  const [editing, setEditing] = useState(false);

  const { data: completeness } = useQuery({
    queryKey: queryKeys.completeness,
    queryFn: profileApiClient.completeness,
    enabled: account?.activeRole === 'intern' && Boolean(internProfile),
  });

  if (!account) return null;
  const isIntern = account.activeRole === 'intern';

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <article className="panel overflow-hidden">
        <ProfileHeaderEditor account={account} />

        <div className="px-5 pb-5">
          <h1 className="mt-3 text-xl font-bold tracking-tight">{account.displayName}</h1>

          {isIntern && internProfile?.headline && (
            <p className="mt-1 text-sm text-fg-muted">{internProfile.headline}</p>
          )}

          {!isIntern && company && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
              <Building2 aria-hidden="true" className="size-4" />
              {company.name}
            </p>
          )}

          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-subtle">
            <li className="flex items-center gap-1.5 capitalize">
              {isIntern ? (
                <GraduationCap aria-hidden="true" className="size-4" />
              ) : (
                <Briefcase aria-hidden="true" className="size-4" />
              )}
              {account.activeRole}
            </li>
            {internProfile?.location && (
              <li className="flex items-center gap-1.5">
                <MapPin aria-hidden="true" className="size-4" />
                {internProfile.location}
              </li>
            )}
            {internProfile?.school && (
              <li className="flex items-center gap-1.5">
                <GraduationCap aria-hidden="true" className="size-4" />
                {internProfile.school}
              </li>
            )}
          </ul>

          {isIntern && internProfile && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={editing ? <Check /> : <Pencil />}
              className="mt-4"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'Done editing' : 'Edit profile'}
            </Button>
          )}
        </div>
      </article>

      {/* FR-202 — what is missing, ranked by how much it matters. */}
      {isIntern && completeness && (
        <CompletenessCard
          score={completeness.score}
          missing={completeness.missing}
          // Every remaining item except the photo is edited in the panel below,
          // and the photo has its own control in the header.
          onAction={(key) => {
            if (key !== 'photo') setEditing(true);
          }}
        />
      )}

      {isIntern && internProfile && editing && <EditPanel />}

      {isIntern && internProfile && !editing && (
        <>
          {internProfile.about && (
            <section className="panel mt-4 p-5">
              <h2 className="mb-2 text-sm font-semibold text-fg">About</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-muted text-pretty">
                {internProfile.about}
              </p>
            </section>
          )}

          {internProfile.skills.length > 0 && (
            <section className="panel mt-4 p-5">
              <h2 className="mb-2.5 text-sm font-semibold text-fg">Skills</h2>
              <ul className="flex flex-wrap gap-1.5">
                {internProfile.skills.map((skill) => (
                  <li
                    key={skill}
                    className="rounded-lg bg-brand-subtle px-2.5 py-1 text-sm font-medium text-brand-fg"
                  >
                    {skill}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* FR-1004 — visible to recruiters only, never broadcast. */}
          {internProfile.openToOpportunities && (
            <Alert variant="success" className="mt-4">
              <span className="flex items-center gap-1.5">
                <Eye aria-hidden="true" className="size-4" />
                Open to opportunities — recruiters can see this; nobody else can.
              </span>
            </Alert>
          )}
        </>
      )}

      <NotificationSettings />

      <SettingsPanel onSignOut={() => void signOut()} />
    </div>
  );
}

function EditPanel() {
  const { internProfile } = useSession();
  const queryClient = useQueryClient();
  const [about, setAbout] = useState(internProfile?.about ?? '');
  const [skills, setSkills] = useState<string[]>(internProfile?.skills ?? []);

  const save = useMutation({
    mutationFn: () => profileApiClient.updateIntern({ about: about || null, skills }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      void queryClient.invalidateQueries({ queryKey: queryKeys.matches });
      toast.success('Profile updated', 'Your matches will refresh with the change.');
    },
    onError: (error) => {
      toast.error(
        'Could not save',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  return (
    <section className="panel mt-4 flex flex-col gap-5 p-5">
      <Field
        label="About"
        hint="A short paragraph. What you are working on, what you want to learn."
        labelAccessory={
          <span className="text-xs text-fg-subtle tabular-nums">{about.length}/2600</span>
        }
      >
        <Textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={5}
          maxLength={2600}
        />
      </Field>

      <Field label="Skills" hint="These drive your matches — keep them current." required>
        <TagInput value={skills} onChange={setSkills} suggestions={SKILL_SUGGESTIONS} max={30} />
      </Field>

      <Button
        onClick={() => save.mutate()}
        isLoading={save.isPending}
        disabled={skills.length < 3}
        title={skills.length < 3 ? 'At least three skills are needed for matching' : undefined}
        className="self-start"
      >
        Save changes
      </Button>
    </section>
  );
}

function SettingsPanel({ onSignOut }: { onSignOut: () => void }) {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: SunMoon },
  ] as const;

  return (
    <section className="panel mt-4 p-5">
      <h2 className="mb-3 text-sm font-semibold text-fg">Appearance</h2>

      <div role="radiogroup" aria-label="Theme" className="flex gap-1 rounded-xl bg-surface-sunken p-1">
        {options.map((option) => (
          <button
            key={option.value}
            role="radio"
            aria-checked={preference === option.value}
            onClick={() => setPreference(option.value)}
            className={cn(
              'flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors duration-[160ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              preference === option.value
                ? 'bg-surface text-fg shadow-xs'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <option.icon aria-hidden="true" className="size-4" />
            {option.label}
          </button>
        ))}
      </div>

      <Button variant="ghost" leftIcon={<LogOut />} onClick={onSignOut} className="mt-4 text-danger-fg">
        Sign out
      </Button>
    </section>
  );
}
