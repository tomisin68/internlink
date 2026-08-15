import type { Availability, WorkMode } from '@internlink/shared-types';

/**
 * Suggestion chips for the skills step.
 *
 * Curated for the launch market (§2.5, Nigeria) and weighted toward the
 * disciplines that dominate internship demand here. These are shortcuts, not a
 * closed vocabulary — the field accepts anything typed.
 */
export const SKILL_SUGGESTIONS = [
  'JavaScript',
  'React',
  'Python',
  'Data Analysis',
  'Figma',
  'UI/UX Design',
  'Content Writing',
  'Digital Marketing',
  'Social Media',
  'Excel',
  'Customer Support',
  'Accounting',
  'Project Management',
  'Sales',
  'Graphic Design',
  'Video Editing',
  'SQL',
  'Node.js',
];

export const AVAILABILITY_OPTIONS: Array<{
  value: Availability;
  title: string;
  description: string;
}> = [
  { value: 'immediately', title: 'Right away', description: 'Ready to start as soon as next week' },
  { value: 'within_1_month', title: 'Within a month', description: 'Wrapping up something first' },
  { value: 'within_3_months', title: 'In 2–3 months', description: 'Planning ahead, e.g. after exams' },
  { value: 'not_looking', title: 'Just browsing', description: 'Not actively looking right now' },
];

export const WORK_MODE_OPTIONS: Array<{ value: WorkMode; title: string; description: string }> = [
  { value: 'remote', title: 'Remote', description: 'Work from anywhere' },
  { value: 'onsite', title: 'On-site', description: 'At the company office' },
  { value: 'hybrid', title: 'Hybrid', description: 'A mix of both' },
];

export const INDUSTRY_OPTIONS = [
  'Technology & Software',
  'Financial Services & Fintech',
  'Media & Entertainment',
  'Healthcare',
  'Education',
  'Retail & E-commerce',
  'Manufacturing',
  'Agriculture',
  'Oil & Gas',
  'Logistics & Transport',
  'Professional Services',
  'Non-profit & NGO',
  'Hospitality & Tourism',
  'Construction & Real Estate',
  'Other',
];

export const COMPANY_SIZE_OPTIONS: Array<{ value: '1-10' | '11-50' | '51-200' | '201-1000' | '1000+'; label: string }> = [
  { value: '1-10', label: '1–10 people' },
  { value: '11-50', label: '11–50 people' },
  { value: '51-200', label: '51–200 people' },
  { value: '201-1000', label: '201–1,000 people' },
  { value: '1000+', label: 'More than 1,000' },
];

/** Initials for the avatar placeholder. Falls back to a single letter. */
export function initialsOf(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.trim()?.[0] ?? '';
  const last = lastName?.trim()?.[0] ?? '';
  return (first + last).toUpperCase() || first.toUpperCase() || '?';
}
