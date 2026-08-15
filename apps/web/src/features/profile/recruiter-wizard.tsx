import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Building2, Globe, MapPin, Phone, ShieldCheck } from 'lucide-react';
import type { CreateRecruiterProfileInput } from '@internlink/shared-types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { FileUpload } from '@/components/ui/upload';
import { Alert } from '@/components/ui/feedback';
import { toast, useSessionStore } from '@/lib/stores';
import { profileApi } from '@/features/auth/auth-api';
import { ApiRequestError } from '@/lib/api-client';
import { WizardShell } from './wizard-shell';
import { COMPANY_SIZE_OPTIONS, INDUSTRY_OPTIONS } from './constants';

const STEPS = [
  { id: 'company', label: 'Your company' },
  { id: 'you', label: 'About you' },
];

const CompanyStepSchema = z.object({
  name: z.string().trim().min(2, 'Enter your company name').max(160),
  industry: z.string().min(1, 'Pick an industry'),
  sizeBand: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+'], {
    errorMap: () => ({ message: 'Pick a company size' }),
  }),
  headquarters: z.string().trim().min(2, 'Where is the company based?').max(120),
  website: z.string().trim().max(200).optional(),
  description: z
    .string()
    .trim()
    .min(40, 'Give candidates at least a couple of sentences')
    .max(4000),
});

const YouStepSchema = z.object({
  title: z.string().trim().min(2, 'What is your role there?').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[\d\s()-]{7,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  cacNumber: z
    .string()
    .trim()
    .regex(/^(RC|BN|IT)?[-\s]?\d{4,10}$/i, 'Enter a valid CAC number, e.g. RC1234567')
    .optional()
    .or(z.literal('')),
});

type CompanyStepInput = z.infer<typeof CompanyStepSchema>;
type YouStepInput = z.infer<typeof YouStepSchema>;

interface Draft extends Partial<CompanyStepInput>, Partial<YouStepInput> {
  logoUrl: string | null;
  verificationDoc: { url: string; name: string } | null;
}

/**
 * Recruiter onboarding — company first, then the person.
 *
 * Company before person on purpose: the company is what candidates evaluate,
 * and asking "what's your job title" before establishing which company it is at
 * reads backwards.
 *
 * FR-302 gates *publishing*, not sign-up, so the CAC number here is optional
 * and framed as unlocking publishing rather than as a wall.
 */
export function RecruiterProfileWizard() {
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<Draft>({ logoUrl: null, verificationDoc: null });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const patch = (values: Partial<Draft>) => setDraft((d) => ({ ...d, ...values }));

  async function submit(values: YouStepInput): Promise<void> {
    setSubmitError(null);
    setIsSubmitting(true);

    const website = draft.website?.trim();
    const payload: CreateRecruiterProfileInput = {
      title: values.title,
      phone: values.phone || null,
      company: {
        name: draft.name!,
        industry: draft.industry!,
        sizeBand: draft.sizeBand!,
        headquarters: draft.headquarters!,
        description: draft.description!,
        website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
        logoUrl: draft.logoUrl,
        cacNumber: values.cacNumber || null,
      },
    };

    try {
      const session = await profileApi.createRecruiterProfile(payload);
      setSession(session);
      toast.success(
        'Company profile created',
        values.cacNumber ? 'We will email you when verification clears.' : 'You can post drafts now.',
      );
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setSubmitError(error.message);
        if (Object.keys(error.fields ?? {}).some((k) => k.startsWith('company.'))) setStep(0);
      } else {
        setSubmitError('We could not save your company. Check your connection and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const meta = [
    {
      title: 'Set up your company',
      description: 'This is your public face on InternLink — candidates see it on every role you post.',
    },
    {
      title: 'And a bit about you',
      description: 'So candidates know who they are talking to when you reach out.',
    },
  ][step]!;

  return (
    <WizardShell
      steps={STEPS}
      current={step}
      direction={direction}
      title={meta.title}
      description={meta.description}
      onBack={
        step > 0
          ? () => {
              setDirection(-1);
              setStep(0);
            }
          : undefined
      }
      actions={
        <>
          {step > 0 && (
            <Button
              variant="ghost"
              size="lg"
              disabled={isSubmitting}
              onClick={() => {
                setDirection(-1);
                setStep(0);
              }}
            >
              Back
            </Button>
          )}
          <Button
            type="submit"
            form={`recruiter-step-${step}`}
            size="lg"
            isLoading={isSubmitting}
            loadingText="Saving…"
            rightIcon={step === 0 ? <ArrowRight /> : undefined}
            className="ml-auto min-w-40"
          >
            {step === 0 ? 'Continue' : 'Finish setup'}
          </Button>
        </>
      }
    >
      {submitError && (
        <Alert variant="error" className="mb-5">
          {submitError}
        </Alert>
      )}

      {step === 0 ? (
        <CompanyStep
          draft={draft}
          patch={patch}
          onNext={() => {
            setDirection(1);
            setStep(1);
          }}
        />
      ) : (
        <YouStep draft={draft} patch={patch} onSubmit={submit} />
      )}
    </WizardShell>
  );
}

function CompanyStep({
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
    watch,
    formState: { errors },
  } = useForm<CompanyStepInput>({
    resolver: zodResolver(CompanyStepSchema),
    mode: 'onBlur',
    defaultValues: {
      name: draft.name ?? '',
      industry: draft.industry ?? '',
      sizeBand: draft.sizeBand ?? undefined,
      headquarters: draft.headquarters ?? '',
      website: draft.website ?? '',
      description: draft.description ?? '',
    },
  });

  const description = watch('description') ?? '';

  return (
    <form
      id="recruiter-step-0"
      onSubmit={handleSubmit((values) => {
        patch(values);
        onNext();
      })}
      noValidate
      className="flex flex-col gap-5"
    >
      <Field label="Company name" error={errors.name?.message} required>
        <Input
          {...register('name')}
          placeholder="Paystack"
          autoComplete="organization"
          leftIcon={<Building2 />}
          autoFocus
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Industry" error={errors.industry?.message} required>
          <Select {...register('industry')}>
            <option value="">Choose one…</option>
            {INDUSTRY_OPTIONS.map((industry) => (
              <option key={industry} value={industry}>
                {industry}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Company size" error={errors.sizeBand?.message} required>
          <Select {...register('sizeBand')}>
            <option value="">Choose one…</option>
            {COMPANY_SIZE_OPTIONS.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Headquarters" error={errors.headquarters?.message} required>
          <Input {...register('headquarters')} placeholder="Lagos, Nigeria" leftIcon={<MapPin />} />
        </Field>

        <Field label="Website" error={errors.website?.message} hint="Optional">
          <Input {...register('website')} placeholder="paystack.com" leftIcon={<Globe />} />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-fg">Company logo</span>
        <FileUpload
          value={draft.logoUrl ? { url: draft.logoUrl, name: 'Company logo' } : null}
          onChange={(file) => patch({ logoUrl: file?.url ?? null })}
          kind="company_logo"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          label="Upload your logo"
          hint="PNG, JPG, WebP or SVG · up to 5MB · square works best"
        />
      </div>

      <Field
        label="What does the company do?"
        error={errors.description?.message}
        hint="Two or three sentences. Candidates read this before they read the role."
        required
        labelAccessory={
          <span className="text-xs text-fg-subtle tabular-nums">{description.length}/4000</span>
        }
      >
        <Textarea
          {...register('description')}
          rows={5}
          maxLength={4000}
          placeholder="We build payments infrastructure for businesses across Africa. Our engineering team of 40 ships to millions of customers…"
        />
      </Field>
    </form>
  );
}

function YouStep({
  draft,
  patch,
  onSubmit,
}: {
  draft: Draft;
  patch: (v: Partial<Draft>) => void;
  onSubmit: (values: YouStepInput) => void | Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<YouStepInput>({
    resolver: zodResolver(YouStepSchema),
    mode: 'onBlur',
    defaultValues: { title: draft.title ?? '', phone: draft.phone ?? '', cacNumber: draft.cacNumber ?? '' },
  });

  return (
    <form
      id="recruiter-step-1"
      onSubmit={handleSubmit((values) => onSubmit(values))}
      noValidate
      className="flex flex-col gap-5"
    >
      <Field label="Your job title" error={errors.title?.message} required>
        <Input {...register('title')} placeholder="Talent Acquisition Lead" autoFocus />
      </Field>

      <Field
        label="Phone number"
        error={errors.phone?.message}
        hint="Optional. Only shown to candidates you are actively talking to."
      >
        <Input
          {...register('phone')}
          type="tel"
          inputMode="tel"
          placeholder="+234 800 000 0000"
          leftIcon={<Phone />}
        />
      </Field>

      <div className="rounded-2xl border border-border-default bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-subtle text-success-fg">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-fg">Get verified</h2>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">
              Verified companies carry a badge on every role and get noticeably more applications.
              You can post drafts right away — verification is what makes a role go live.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <Field
            label="CAC registration number"
            error={errors.cacNumber?.message}
            hint="Optional now. You can add it later from company settings."
          >
            <Input {...register('cacNumber')} placeholder="RC1234567" autoCapitalize="characters" />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-fg">Registration document</span>
            <FileUpload
              value={draft.verificationDoc}
              onChange={(verificationDoc) => patch({ verificationDoc })}
              kind="verification_doc"
              accept=".pdf,.jpg,.jpeg,.png"
              label="Upload your CAC certificate"
              hint="PDF or image · up to 15MB · encrypted at rest, seen only by our review team"
            />
          </div>
        </div>
      </div>
    </form>
  );
}
