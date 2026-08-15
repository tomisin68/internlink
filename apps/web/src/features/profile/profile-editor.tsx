import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, GraduationCap, Link2, Plus, Trash2 } from 'lucide-react';
import type {
  EducationEntry,
  ExperienceEntry,
  InternProfile,
  PortfolioLink,
} from '@internlink/shared-types';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field';
import { TagInput } from '@/components/ui/tag-input';
import { FileUpload } from '@/components/ui/upload';
import { profileApiClient, queryKeys } from '@/lib/api-endpoints';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';
import { SKILL_SUGGESTIONS } from './constants';

/**
 * The whole intern profile, editable from the profile screen.
 *
 * Previously this panel offered About and Skills and nothing else, which meant
 * the only route to experience, education or a CV was re-running the onboarding
 * wizard — and the wizard is a one-way flow that does not exist any more once
 * onboarding is finished. Everything the profile stores is editable here.
 *
 * One save button for the whole form rather than per-section saves. The
 * sections are not independent: completeness (FR-202) is recomputed across all
 * of them, and five separate writes would make the progress ring jump five
 * times for what the user experienced as one edit.
 */

/** Entries carry an id from the server; new ones are keyed locally until saved. */
type DraftExperience = Omit<ExperienceEntry, 'id'> & { key: string };
type DraftEducation = Omit<EducationEntry, 'id'> & { key: string };

let keySeed = 0;
const nextKey = () => `draft_${(keySeed += 1)}`;

const currentYear = new Date().getFullYear();

function toDraftExperience(entry: ExperienceEntry): DraftExperience {
  const { id: _id, ...rest } = entry;
  void _id;
  return { ...rest, key: nextKey() };
}

function toDraftEducation(entry: EducationEntry): DraftEducation {
  const { id: _id, ...rest } = entry;
  void _id;
  return { ...rest, key: nextKey() };
}

export function ProfileEditor({
  profile,
  onDone,
}: {
  profile: InternProfile;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();

  const [headline, setHeadline] = useState(profile.headline ?? '');
  const [location, setLocation] = useState(profile.location ?? '');
  const [school, setSchool] = useState(profile.school ?? '');
  const [about, setAbout] = useState(profile.about ?? '');
  const [skills, setSkills] = useState<string[]>(profile.skills ?? []);
  const [experience, setExperience] = useState<DraftExperience[]>(
    (profile.experience ?? []).map(toDraftExperience),
  );
  const [education, setEducation] = useState<DraftEducation[]>(
    (profile.education ?? []).map(toDraftEducation),
  );
  const [links, setLinks] = useState<PortfolioLink[]>(profile.portfolioLinks ?? []);
  const [cv, setCv] = useState<{ url: string; name: string } | null>(
    profile.cvUrl ? { url: profile.cvUrl, name: profile.cvFileName ?? 'Your CV' } : null,
  );
  const [openToOpportunities, setOpenToOpportunities] = useState(profile.openToOpportunities);

  const save = useMutation({
    mutationFn: () =>
      profileApiClient.updateIntern({
        headline: headline.trim() || undefined,
        location: location.trim() || undefined,
        school: school.trim() || undefined,
        about: about.trim() || null,
        skills,
        cvUrl: cv?.url ?? null,
        cvFileName: cv?.name ?? null,
        portfolioLinks: links.filter((link) => link.label.trim() && link.url.trim()),
        // Ids are assigned server-side on write, so drafts go up without them.
        experience: experience.map(({ key: _key, ...entry }) => entry),
        education: education.map(({ key: _key, ...entry }) => entry),
        openToOpportunities,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      void queryClient.invalidateQueries({ queryKey: queryKeys.matches });
      toast.success('Profile updated', 'Your matches will refresh with the change.');
      onDone();
    },
    onError: (error) => {
      toast.error(
        'Could not save',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  function addExperience(): void {
    setExperience((current) => [
      ...current,
      {
        key: nextKey(),
        title: '',
        company: '',
        workMode: null,
        location: null,
        startDate: `${currentYear}-01`,
        endDate: null,
        isCurrent: true,
        description: null,
      },
    ]);
  }

  function addEducation(): void {
    setEducation((current) => [
      ...current,
      {
        key: nextKey(),
        school: '',
        degree: null,
        fieldOfStudy: null,
        startYear: currentYear - 3,
        endYear: null,
        grade: null,
      },
    ]);
  }

  // Skills below three switch matching off entirely (FR-204), so the button
  // says why rather than just refusing.
  const blocked = skills.length < 3;

  return (
    <div className="mt-4 flex flex-col gap-4">
      <section className="panel flex flex-col gap-5 p-5">
        <h2 className="text-sm font-semibold text-fg">Basics</h2>

        <Field
          label="Headline"
          hint="One line. What you do, or what you are looking for."
          labelAccessory={
            <span className="text-xs text-fg-subtle tabular-nums">{headline.length}/140</span>
          }
        >
          <Input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={140}
            placeholder="Frontend developer looking for a first internship"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Location">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={120}
              placeholder="Lagos, Nigeria"
            />
          </Field>
          <Field label="School">
            <Input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              maxLength={160}
              placeholder="University of Lagos"
            />
          </Field>
        </div>
      </section>

      <section className="panel flex flex-col gap-5 p-5">
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
      </section>

      {/* ------------------------------------------------------ experience -- */}
      <section className="panel p-5">
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Briefcase aria-hidden="true" className="size-4 text-fg-subtle" />
            Experience
          </h2>
          <Button size="sm" variant="outline" leftIcon={<Plus />} onClick={addExperience}>
            Add
          </Button>
        </header>

        {experience.length === 0 && (
          <p className="text-sm text-fg-subtle">
            Internships, part-time work, freelance projects — anything you were paid or trusted to
            do counts.
          </p>
        )}

        <ul className="flex flex-col gap-4">
          {experience.map((entry, index) => (
            <li key={entry.key} className="rounded-xl border border-border-subtle p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-fg-subtle">Role {index + 1}</p>
                <RemoveButton
                  label="Remove this role"
                  onClick={() =>
                    setExperience((current) => current.filter((e) => e.key !== entry.key))
                  }
                />
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Title" required>
                    <Input
                      value={entry.title}
                      onChange={(e) => patchExperience(setExperience, entry.key, { title: e.target.value })}
                      maxLength={140}
                      placeholder="Frontend Intern"
                    />
                  </Field>
                  <Field label="Company" required>
                    <Input
                      value={entry.company}
                      onChange={(e) =>
                        patchExperience(setExperience, entry.key, { company: e.target.value })
                      }
                      maxLength={160}
                      placeholder="Paystack"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Started" hint="Month and year">
                    <Input
                      type="month"
                      value={entry.startDate}
                      onChange={(e) =>
                        patchExperience(setExperience, entry.key, { startDate: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Finished" hint="Leave blank if this is current">
                    <Input
                      type="month"
                      value={entry.endDate ?? ''}
                      disabled={entry.isCurrent}
                      onChange={(e) =>
                        patchExperience(setExperience, entry.key, {
                          endDate: e.target.value || null,
                        })
                      }
                    />
                  </Field>
                </div>

                <Checkbox
                  label="I still work here"
                  checked={entry.isCurrent}
                  onChange={(e) =>
                    patchExperience(setExperience, entry.key, {
                      isCurrent: e.target.checked,
                      // A current role cannot also have an end date; clearing it
                      // here stops the two fields contradicting each other.
                      endDate: e.target.checked ? null : entry.endDate,
                    })
                  }
                />

                <Field label="What did you do?" hint="Optional">
                  <Textarea
                    value={entry.description ?? ''}
                    onChange={(e) =>
                      patchExperience(setExperience, entry.key, {
                        description: e.target.value || null,
                      })
                    }
                    rows={3}
                    maxLength={2000}
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------- education -- */}
      <section className="panel p-5">
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <GraduationCap aria-hidden="true" className="size-4 text-fg-subtle" />
            Education
          </h2>
          <Button size="sm" variant="outline" leftIcon={<Plus />} onClick={addEducation}>
            Add
          </Button>
        </header>

        {education.length === 0 && (
          <p className="text-sm text-fg-subtle">
            Add your school so recruiters and classmates can find you.
          </p>
        )}

        <ul className="flex flex-col gap-4">
          {education.map((entry, index) => (
            <li key={entry.key} className="rounded-xl border border-border-subtle p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-fg-subtle">Entry {index + 1}</p>
                <RemoveButton
                  label="Remove this entry"
                  onClick={() =>
                    setEducation((current) => current.filter((e) => e.key !== entry.key))
                  }
                />
              </div>

              <div className="flex flex-col gap-4">
                <Field label="School" required>
                  <Input
                    value={entry.school}
                    onChange={(e) =>
                      patchEducation(setEducation, entry.key, { school: e.target.value })
                    }
                    maxLength={160}
                    placeholder="University of Lagos"
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Degree" hint="Optional">
                    <Input
                      value={entry.degree ?? ''}
                      onChange={(e) =>
                        patchEducation(setEducation, entry.key, { degree: e.target.value || null })
                      }
                      maxLength={120}
                      placeholder="BSc"
                    />
                  </Field>
                  <Field label="Field of study" hint="Optional">
                    <Input
                      value={entry.fieldOfStudy ?? ''}
                      onChange={(e) =>
                        patchEducation(setEducation, entry.key, {
                          fieldOfStudy: e.target.value || null,
                        })
                      }
                      maxLength={120}
                      placeholder="Computer Science"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Started">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1950}
                      max={2100}
                      value={entry.startYear}
                      onChange={(e) =>
                        patchEducation(setEducation, entry.key, {
                          startYear: Number(e.target.value) || currentYear,
                        })
                      }
                    />
                  </Field>
                  <Field label="Finished" hint="Leave blank if you are still studying">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1950}
                      max={2100}
                      value={entry.endYear ?? ''}
                      onChange={(e) =>
                        patchEducation(setEducation, entry.key, {
                          endYear: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  </Field>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------------------------------- CV/links -- */}
      <section className="panel flex flex-col gap-5 p-5">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-fg">CV</h2>
          <FileUpload
            value={cv}
            onChange={setCv}
            kind="cv"
            accept=".pdf,.doc,.docx"
            label="CV upload"
            hint="PDF or Word, up to 10MB. Recruiters see this when you apply."
          />
        </div>

        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            <Link2 aria-hidden="true" className="size-4 text-fg-subtle" />
            Links
          </h2>

          <ul className="flex flex-col gap-2">
            {links.map((link, index) => (
              <li key={index} className="flex items-end gap-2">
                <Field label="Label" className="w-32 shrink-0">
                  <Input
                    value={link.label}
                    onChange={(e) =>
                      setLinks((current) =>
                        current.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)),
                      )
                    }
                    maxLength={60}
                    placeholder="GitHub"
                  />
                </Field>
                <Field label="URL" className="min-w-0 flex-1">
                  <Input
                    value={link.url}
                    onChange={(e) =>
                      setLinks((current) =>
                        current.map((l, i) => (i === index ? { ...l, url: e.target.value } : l)),
                      )
                    }
                    placeholder="https://github.com/you"
                  />
                </Field>
                <RemoveButton
                  label="Remove this link"
                  onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
                />
              </li>
            ))}
          </ul>

          {links.length < 6 && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus />}
              className="mt-2"
              onClick={() => setLinks((current) => [...current, { label: '', url: '' }])}
            >
              Add a link
            </Button>
          )}
        </div>

        {/* FR-1004 — visible to recruiters only, never broadcast. */}
        <Checkbox
          label="Open to opportunities — recruiters can see this; nobody else can."
          checked={openToOpportunities}
          onChange={(e) => setOpenToOpportunities(e.target.checked)}
        />
      </section>

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] flex gap-2 rounded-2xl border border-border-default bg-surface/95 p-3 backdrop-blur-md lg:bottom-4">
        <Button
          onClick={() => save.mutate()}
          isLoading={save.isPending}
          disabled={blocked}
          title={blocked ? 'At least three skills are needed for matching' : undefined}
        >
          Save changes
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {blocked && (
          <p className="self-center text-xs text-fg-subtle">Add at least three skills to save.</p>
        )}
      </div>
    </div>
  );
}

function patchExperience(
  set: React.Dispatch<React.SetStateAction<DraftExperience[]>>,
  key: string,
  patch: Partial<DraftExperience>,
): void {
  set((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
}

function patchEducation(
  set: React.Dispatch<React.SetStateAction<DraftEducation[]>>,
  key: string,
  patch: Partial<DraftEducation>,
): void {
  set((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-danger-subtle hover:text-danger-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
    >
      <Trash2 aria-hidden="true" className="size-4" />
    </button>
  );
}
