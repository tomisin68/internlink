import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Link2, MapPin, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Availability, CreateInternProfileInput, WorkMode } from '@internlink/shared-types';
import { Button, IconButton } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { OptionCard } from '@/components/ui/option-card';
import { TagInput } from '@/components/ui/tag-input';
import { AvatarUpload, FileUpload } from '@/components/ui/upload';
import { Alert } from '@/components/ui/feedback';
import { ProgressRing } from '@/components/ui/stepper';
import { toast, useSessionStore } from '@/lib/stores';
import { useSession } from '@/features/auth/use-auth';
import { profileApi } from '@/features/auth/auth-api';
import { ApiRequestError } from '@/lib/api-client';
import { WizardShell } from './wizard-shell';
import {
  AVAILABILITY_OPTIONS,
  SKILL_SUGGESTIONS,
  WORK_MODE_OPTIONS,
  initialsOf,
} from './constants';

const STEPS = [
  { id: 'basics', label: 'About you' },
  { id: 'education', label: 'Education' },
  { id: 'skills', label: 'Skills' },
  { id: 'extras', label: 'Finishing touches' },
];

/* ---------------------------------------------------------- step schemas -- */

const BasicsSchema = z.object({
  headline: z
    .string()
    .trim()
    .min(10, 'A few more words — at least 10 characters')
    .max(140, 'Keep it under 140 characters'),
  location: z.string().trim().min(2, 'Where are you based?').max(120),
});

const currentYear = new Date().getFullYear();

const EducationSchema = z.object({
  school: z.string().trim().min(2, 'Enter your school').max(160),
  degree: z.string().trim().max(120).optional(),
  fieldOfStudy: z.string().trim().max(120).optional(),
  startYear: z.coerce
    .number()
    .int()
    .min(1950, 'That looks too early')
    .max(currentYear + 1, 'That is in the future'),
  endYear: z.coerce
    .number()
    .int()
    .min(1950)
    .max(currentYear + 10)
    .optional(),
});

const ExtrasSchema = z.object({
  about: z.string().trim().max(2600).optional(),
});

type BasicsInput = z.infer<typeof BasicsSchema>;
type EducationInput = z.infer<typeof EducationSchema>;
type ExtrasInput = z.infer<typeof ExtrasSchema>;

interface Draft {
  photoUrl: string | null;
  headline: string;
  location: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  startYear: number;
  endYear: number | null;
  skills: string[];
  availability: Availability;
  preferredWorkModes: WorkMode[];
  about: string;
  cv: { url: string; name: string } | null;
  portfolioLinks: Array<{ label: string; url: string }>;
}

const EMPTY_DRAFT: Draft = {
  photoUrl: null,
  headline: '',
  location: '',
  school: '',
  degree: '',
  fieldOfStudy: '',
  startYear: currentYear,
  endYear: null,
  skills: [],
  availability: 'immediately',
  preferredWorkModes: ['remote', 'hybrid'],
  about: '',
  cv: null,
  portfolioLinks: [],
};

/**
 * Intern profile wizard — FR-201.
 *
 * The draft lives in this component rather than in each step's form, so moving
 * back and forth never loses what was typed. Each step validates only its own
 * slice; the whole thing is submitted once at the end.
 */
export function InternProfileWizard() {
  const navigate = useNavigate();
  const { account } = useSession();
  const setSession = useSessionStore((s) => s.setSession);

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const patch = (values: Partial<Draft>) => setDraft((d) => ({ ...d, ...values }));

  const goNext = () => {
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  };

  /**
   * Live preview of the server-side completeness score (FR-202).
   *
   * Mirrors the backend's weights so the ring moves as the user types instead
   * of only after submission. The server's number is authoritative — this is a
   * motivator, not a source of truth.
   */
  const completeness = useMemo(() => {
    const checks: Array<[boolean, number]> = [
      [Boolean(account?.firstName && account?.lastName), 5],
      [Boolean(draft.photoUrl), 10],
      [draft.headline.length >= 10, 12],
      [draft.about.length >= 80, 10],
      [Boolean(draft.location), 5],
      [draft.skills.length >= 3, 18],
      [Boolean(draft.school), 15],
      [false, 10], // experience — not collected during onboarding
      [Boolean(draft.cv), 10],
      [draft.portfolioLinks.length > 0, 5],
    ];
    const earned = checks.reduce((sum, [passed, weight]) => sum + (passed ? weight : 0), 0);
    return Math.round((earned / 100) * 100);
  }, [account, draft]);

  async function submit(): Promise<void> {
    setSubmitError(null);
    setIsSubmitting(true);

    const payload: CreateInternProfileInput = {
      headline: draft.headline,
      location: draft.location,
      photoUrl: draft.photoUrl,
      school: draft.school,
      education: draft.school
        ? [
            {
              school: draft.school,
              degree: draft.degree || null,
              fieldOfStudy: draft.fieldOfStudy || null,
              startYear: draft.startYear,
              endYear: draft.endYear,
              grade: null,
            },
          ]
        : [],
      skills: draft.skills,
      availability: draft.availability,
      preferredWorkModes: draft.preferredWorkModes,
      about: draft.about || null,
      cvUrl: draft.cv?.url ?? null,
      cvFileName: draft.cv?.name ?? null,
      portfolioLinks: draft.portfolioLinks,
      experience: [],
      certifications: [],
      openToOpportunities: true,
      visibility: 'public',
    };

    try {
      const session = await profileApi.createInternProfile(payload);
      setSession(session);
      toast.success('Your profile is live', 'Time to find some roles.');
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setSubmitError(error.message);
        // Send the user back to the step that owns the offending field rather
        // than leaving them staring at an error about something off-screen.
        const bad = Object.keys(error.fields ?? {})[0] ?? '';
        if (/^(headline|location)/.test(bad)) setStep(0);
        else if (/^(school|education)/.test(bad)) setStep(1);
        else if (/^(skills|availability|preferredWorkModes)/.test(bad)) setStep(2);
      } else {
        setSubmitError('We could not save your profile. Check your connection and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const stepMeta = [
    {
      title: 'Tell us about you',
      description: 'This is the first thing a recruiter sees. A clear headline does most of the work.',
    },
    {
      title: 'Where are you studying?',
      description: 'Your school helps us match you to roles that recruit from it.',
    },
    {
      title: 'What can you do?',
      description: 'Skills drive your matches. Add at least three — the more specific, the better.',
    },
    {
      title: 'Almost there',
      description: 'All optional, but each one makes your profile harder to scroll past.',
    },
  ][step]!;

  return (
    <WizardShell
      steps={STEPS}
      current={step}
      direction={direction}
      title={stepMeta.title}
      description={stepMeta.description}
      onBack={step > 0 ? goBack : undefined}
      onStepClick={(index) => {
        setDirection(index > step ? 1 : -1);
        setStep(index);
      }}
      aside={<ProgressRing value={completeness} className="mt-1 shrink-0" />}
      actions={
        <StepActions
          step={step}
          isSubmitting={isSubmitting}
          onBack={goBack}
          onSkip={step === 3 ? submit : undefined}
        />
      }
    >
      {submitError && (
        <Alert variant="error" className="mb-5">
          {submitError}
        </Alert>
      )}

      {step === 0 && (
        <BasicsStep
          draft={draft}
          patch={patch}
          onNext={goNext}
          fallback={initialsOf(account?.firstName, account?.lastName)}
        />
      )}
      {step === 1 && <EducationStep draft={draft} patch={patch} onNext={goNext} />}
      {step === 2 && <SkillsStep draft={draft} patch={patch} onNext={goNext} />}
      {step === 3 && <ExtrasStep draft={draft} patch={patch} onSubmit={submit} />}
    </WizardShell>
  );
}

/* ------------------------------------------------------------- footer ----- */

function StepActions({
  step,
  isSubmitting,
  onBack,
  onSkip,
}: {
  step: number;
  isSubmitting: boolean;
  onBack: () => void;
  onSkip?: (() => void) | undefined;
}) {
  const isLast = step === STEPS.length - 1;

  return (
    <>
      {step > 0 && (
        <Button variant="ghost" size="lg" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
      )}
      {/* Skip only exists on the last step, where every field really is
          optional. Offering it earlier would let people through without the
          skills that make the product work. */}
      {isLast && onSkip && (
        <Button variant="ghost" size="lg" onClick={onSkip} disabled={isSubmitting}>
          Skip for now
        </Button>
      )}
      <Button
        type="submit"
        form={`intern-step-${step}`}
        size="lg"
        isLoading={isSubmitting}
        loadingText="Saving…"
        rightIcon={isLast ? undefined : <ArrowRight />}
        className="ml-auto min-w-40"
      >
        {isLast ? 'Finish profile' : 'Continue'}
      </Button>
    </>
  );
}

/* -------------------------------------------------------------- step 1 ---- */

function BasicsStep({
  draft,
  patch,
  onNext,
  fallback,
}: {
  draft: Draft;
  patch: (v: Partial<Draft>) => void;
  onNext: () => void;
  fallback: string;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<BasicsInput>({
    resolver: zodResolver(BasicsSchema),
    mode: 'onBlur',
    defaultValues: { headline: draft.headline, location: draft.location },
  });

  const headline = watch('headline') ?? '';

  return (
    <form
      id="intern-step-0"
      onSubmit={handleSubmit((values) => {
        patch(values);
        onNext();
      })}
      noValidate
      className="flex flex-col gap-6"
    >
      <AvatarUpload
        value={draft.photoUrl}
        onChange={(photoUrl) => patch({ photoUrl })}
        fallback={fallback}
      />

      <Field
        label="Headline"
        error={errors.headline?.message}
        hint="One line on who you are and what you're after."
        required
        labelAccessory={
          <span
            className={`text-xs tabular-nums ${headline.length > 140 ? 'text-danger-fg' : 'text-fg-subtle'}`}
          >
            {headline.length}/140
          </span>
        }
      >
        <Input
          {...register('headline')}
          placeholder="Final-year CS student looking for a frontend internship"
          maxLength={160}
          leftIcon={<Sparkles />}
          autoFocus
        />
      </Field>

      <Field label="Location" error={errors.location?.message} hint="City and state is plenty." required>
        <Input {...register('location')} placeholder="Lagos, Nigeria" leftIcon={<MapPin />} />
      </Field>
    </form>
  );
}

/* -------------------------------------------------------------- step 2 ---- */

function EducationStep({
  draft,
  patch,
  onNext,
}: {
  draft: Draft;
  patch: (v: Partial<Draft>) => void;
  onNext: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EducationInput>({
    resolver: zodResolver(EducationSchema),
    mode: 'onBlur',
    defaultValues: {
      school: draft.school,
      degree: draft.degree,
      fieldOfStudy: draft.fieldOfStudy,
      startYear: draft.startYear,
      ...(draft.endYear !== null ? { endYear: draft.endYear } : {}),
    },
  });

  const years = Array.from({ length: 60 }, (_, i) => currentYear + 6 - i);

  return (
    <form
      id="intern-step-1"
      onSubmit={handleSubmit((values) => {
        patch({
          school: values.school,
          degree: values.degree ?? '',
          fieldOfStudy: values.fieldOfStudy ?? '',
          startYear: values.startYear,
          endYear: values.endYear ?? null,
        });
        onNext();
      })}
      noValidate
      className="flex flex-col gap-5"
    >
      <Field label="School or university" error={errors.school?.message} required>
        <Input
          {...register('school')}
          placeholder="University of Lagos"
          autoComplete="organization"
          autoFocus
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Degree" error={errors.degree?.message} hint="Optional">
          <Input {...register('degree')} placeholder="BSc" />
        </Field>
        <Field label="Field of study" error={errors.fieldOfStudy?.message} hint="Optional">
          <Input {...register('fieldOfStudy')} placeholder="Computer Science" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Started" error={errors.startYear?.message} required>
          <select
            {...register('startYear')}
            className="h-11 w-full cursor-pointer rounded-xl border border-border-default bg-surface px-3.5 text-base transition-[border-color,box-shadow] hover:border-border-strong focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Finished (or expected)"
          error={errors.endYear?.message}
          hint="Leave blank if you're still studying"
        >
          <select
            {...register('endYear')}
            className="h-11 w-full cursor-pointer rounded-xl border border-border-default bg-surface px-3.5 text-base transition-[border-color,box-shadow] hover:border-border-strong focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
          >
            <option value="">Still studying</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- step 3 ---- */

function SkillsStep({
  draft,
  patch,
  onNext,
}: {
  draft: Draft;
  patch: (v: Partial<Draft>) => void;
  onNext: () => void;
}) {
  const [skillError, setSkillError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const skillsOk = draft.skills.length >= 3;
    const modesOk = draft.preferredWorkModes.length >= 1;

    setSkillError(skillsOk ? null : 'Add at least 3 skills so we can match you to roles');
    setModeError(modesOk ? null : 'Pick at least one way you would like to work');

    if (skillsOk && modesOk) onNext();
  }

  function toggleMode(mode: WorkMode): void {
    const next = draft.preferredWorkModes.includes(mode)
      ? draft.preferredWorkModes.filter((m) => m !== mode)
      : [...draft.preferredWorkModes, mode];
    patch({ preferredWorkModes: next });
    if (next.length > 0) setModeError(null);
  }

  return (
    <form id="intern-step-2" onSubmit={handleSubmit} noValidate className="flex flex-col gap-7">
      <Field
        label="Your skills"
        error={skillError ?? undefined}
        hint={`${draft.skills.length} added — three is the minimum, five or six is ideal.`}
        required
      >
        <TagInput
          value={draft.skills}
          onChange={(skills) => {
            patch({ skills });
            if (skills.length >= 3) setSkillError(null);
          }}
          suggestions={SKILL_SUGGESTIONS}
          error={Boolean(skillError)}
          max={30}
        />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-fg">
          When can you start?
          <span aria-hidden="true" className="ml-0.5 text-accent-fg">
            *
          </span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {AVAILABILITY_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              name="availability"
              selected={draft.availability === option.value}
              onSelect={() => patch({ availability: option.value })}
              title={option.title}
              description={option.description}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-fg">
          How would you like to work?
          <span aria-hidden="true" className="ml-0.5 text-accent-fg">
            *
          </span>
          <span className="ml-2 text-xs font-normal text-fg-subtle">Pick any that apply</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {WORK_MODE_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              multiple
              selected={draft.preferredWorkModes.includes(option.value)}
              onSelect={() => toggleMode(option.value)}
              title={option.title}
              description={option.description}
            />
          ))}
        </div>
        {modeError && (
          <p role="alert" className="text-xs font-medium text-danger-fg">
            {modeError}
          </p>
        )}
      </fieldset>
    </form>
  );
}

/* -------------------------------------------------------------- step 4 ---- */

function ExtrasStep({
  draft,
  patch,
  onSubmit,
}: {
  draft: Draft;
  patch: (v: Partial<Draft>) => void;
  onSubmit: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ExtrasInput>({
    resolver: zodResolver(ExtrasSchema),
    mode: 'onBlur',
    defaultValues: { about: draft.about },
  });

  const about = watch('about') ?? '';
  const [linkDraft, setLinkDraft] = useState({ label: '', url: '' });

  function addLink(): void {
    const label = linkDraft.label.trim();
    const url = linkDraft.url.trim();
    if (!label || !url) return;

    // Be forgiving about the protocol — people type "github.com/ada".
    const normalised = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      new URL(normalised);
    } catch {
      toast.error('That link does not look right', 'Check the address and try again.');
      return;
    }

    patch({ portfolioLinks: [...draft.portfolioLinks, { label, url: normalised }].slice(0, 6) });
    setLinkDraft({ label: '', url: '' });
  }

  return (
    <form
      id="intern-step-3"
      onSubmit={handleSubmit((values) => {
        patch({ about: values.about ?? '' });
        onSubmit();
      })}
      noValidate
      className="flex flex-col gap-7"
    >
      <Field
        label="About you"
        error={errors.about?.message}
        hint="A short paragraph. What you're working on, what you want to learn."
        labelAccessory={
          <span className="text-xs text-fg-subtle tabular-nums">{about.length}/2600</span>
        }
      >
        <Textarea
          {...register('about')}
          rows={5}
          maxLength={2600}
          placeholder="I'm a final-year Computer Science student at UNILAG. I've built three React projects and I'm looking for a frontend internship where I can learn from a senior team…"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-fg">Your CV</span>
        <FileUpload
          value={draft.cv}
          onChange={(cv) => patch({ cv })}
          kind="cv"
          accept=".pdf,.doc,.docx"
          label="Upload your CV"
          hint="PDF or Word · up to 10MB · lets you apply in one tap"
        />
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium text-fg">Portfolio links</span>

        {draft.portfolioLinks.length > 0 && (
          <ul className="flex flex-col gap-2">
            {draft.portfolioLinks.map((link, index) => (
              <li
                key={`${link.url}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-border-default bg-surface p-3"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand-fg">
                  <Link2 aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{link.label}</p>
                  <p className="truncate text-xs text-fg-subtle">{link.url}</p>
                </div>
                <IconButton
                  size="sm"
                  label={`Remove ${link.label}`}
                  icon={<Trash2 />}
                  onClick={() =>
                    patch({ portfolioLinks: draft.portfolioLinks.filter((_, i) => i !== index) })
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {draft.portfolioLinks.length < 6 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={linkDraft.label}
              onChange={(e) => setLinkDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="GitHub"
              aria-label="Link name"
              className="h-11 rounded-xl border border-border-default bg-surface px-3.5 text-base placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none sm:w-36"
            />
            <input
              type="url"
              inputMode="url"
              value={linkDraft.url}
              onChange={(e) => setLinkDraft((d) => ({ ...d, url: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLink();
                }
              }}
              placeholder="github.com/yourname"
              aria-label="Link address"
              className="h-11 flex-1 rounded-xl border border-border-default bg-surface px-3.5 text-base placeholder:text-fg-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_16%,transparent)] focus:outline-none"
            />
            <Button
              variant="outline"
              onClick={addLink}
              leftIcon={<Plus />}
              disabled={!linkDraft.label.trim() || !linkDraft.url.trim()}
            >
              Add
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
