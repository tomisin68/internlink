import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowLeft, MapPin, ShieldAlert } from 'lucide-react';
import type { WorkMode } from '@internlink/shared-types';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { OptionCard } from '@/components/ui/option-card';
import { TagInput } from '@/components/ui/tag-input';
import { Alert } from '@/components/ui/feedback';
import { listingsApi, queryKeys } from '@/lib/api-endpoints';
import { useSession } from '@/features/auth/use-auth';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { SKILL_SUGGESTIONS, WORK_MODE_OPTIONS } from '@/features/profile/constants';

const ComposerSchema = z.object({
  title: z.string().trim().min(4, 'Give the role a title').max(160),
  description: z
    .string()
    .trim()
    .min(80, 'Describe the role in a little more detail — at least 80 characters')
    .max(12000),
  location: z.string().trim().max(120).optional(),
  durationMonths: z.coerce.number().int().min(1).max(36).optional(),
});

type ComposerInput = z.infer<typeof ComposerSchema>;

/** FR-303 — create a role. Publishing is gated on verification (FR-302). */
export function RoleComposerScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { company } = useSession();

  const [skills, setSkills] = useState<string[]>([]);
  const [workMode, setWorkMode] = useState<WorkMode>('hybrid');
  const [skillError, setSkillError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ComposerInput>({
    resolver: zodResolver(ComposerSchema),
    mode: 'onBlur',
    defaultValues: { title: '', description: '', location: '' },
  });

  const description = watch('description') ?? '';
  const isVerified = company?.verificationStatus === 'verified';

  const create = useMutation({
    mutationFn: (args: { values: ComposerInput; status: 'draft' | 'active' }) =>
      listingsApi.create({
        title: args.values.title,
        description: args.values.description,
        skills,
        location: args.values.location || null,
        workMode,
        durationMonths: args.values.durationMonths ?? null,
        status: args.status,
      }),
    onSuccess: (listing) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myListings });
      toast.success(
        listing.status === 'active' ? 'Role is live' : 'Saved as draft',
        listing.status === 'active'
          ? 'Candidates can find it now.'
          : 'Publish it once your company is verified.',
      );
      navigate('/roles');
    },
    onError: (error) => {
      toast.error(
        'Could not save the role',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  function submit(status: 'draft' | 'active') {
    return handleSubmit((values) => {
      if (skills.length === 0) {
        setSkillError('Add at least one skill');
        return;
      }
      setSkillError(null);
      create.mutate({ values, status });
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back
      </button>

      <h1 className="text-2xl font-bold tracking-tight">Post a role</h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        The skills you list here are what candidates get matched against, so be specific.
      </p>

      {/* FR-302 stated up front, not discovered at the point of failure. */}
      {!isVerified && (
        <Alert variant="warning" title="Verification needed to publish" className="mt-5">
          You can write and save this role now. It goes live the moment your company&rsquo;s CAC
          verification clears — we will email you.
        </Alert>
      )}

      <form className="mt-5 flex flex-col gap-5">
        <Field label="Role title" error={errors.title?.message} required>
          <Input {...register('title')} placeholder="Frontend Engineering Intern" autoFocus />
        </Field>

        <Field
          label="Skills"
          error={skillError ?? undefined}
          hint="What a candidate needs to do this job. These drive matching."
          required
        >
          <TagInput
            value={skills}
            onChange={(next) => {
              setSkills(next);
              if (next.length > 0) setSkillError(null);
            }}
            suggestions={SKILL_SUGGESTIONS}
            error={Boolean(skillError)}
            max={20}
            placeholder="Type a skill and press Enter"
          />
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">How will they work?</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {WORK_MODE_OPTIONS.map((option) => (
              <OptionCard
                key={option.value}
                name="workMode"
                selected={workMode === option.value}
                onSelect={() => setWorkMode(option.value)}
                title={option.title}
                description={option.description}
              />
            ))}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Location"
            error={errors.location?.message}
            hint={workMode === 'remote' ? 'Optional for remote roles' : 'City and state'}
          >
            <Input {...register('location')} placeholder="Lagos, Nigeria" leftIcon={<MapPin />} />
          </Field>

          <Field label="Duration (months)" error={errors.durationMonths?.message} hint="Optional">
            <Input
              {...register('durationMonths')}
              type="number"
              inputMode="numeric"
              min={1}
              max={36}
              placeholder="6"
            />
          </Field>
        </div>

        <Field
          label="About the role"
          error={errors.description?.message}
          hint="What they will do, who they will work with, what they will learn."
          required
          labelAccessory={
            <span className="text-xs text-fg-subtle tabular-nums">{description.length}/12000</span>
          }
        >
          <Textarea
            {...register('description')}
            rows={9}
            maxLength={12000}
            placeholder="You will join our four-person frontend team building the customer dashboard in React…"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
          <Button
            type="button"
            size="lg"
            onClick={submit('active')}
            isLoading={create.isPending}
            disabled={!isVerified}
            title={isVerified ? undefined : 'Your company needs to be verified first'}
          >
            Publish
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={submit('draft')}>
            Save as draft
          </Button>

          {!isVerified && (
            <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <ShieldAlert aria-hidden="true" className="size-3.5" />
              Publishing unlocks after verification
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
