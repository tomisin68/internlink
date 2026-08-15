import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check, ChevronDown, MapPin, Plus, Sparkles, Timer } from 'lucide-react';
import type { MatchResult } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { feedApi, queryKeys } from '@/lib/api-endpoints';

/**
 * FR-204 — "Matches for you".
 *
 * The score is never shown bare. Every card leads with the reasons the ranker
 * produced, and the breakdown is one tap away — a percentage with no
 * explanation invites people to distrust it, and gives them nothing to act on.
 */
export function MatchesScreen() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.matches,
    queryFn: () => feedApi.getMatches(),
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Matches for you</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Ranked against your skills, location and availability — not just the newest listings.
        </p>
      </header>

      {isLoading && (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-44 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {/* The server distinguishes "no matches" from "profile too thin to
          match" — this is the second case, and it comes with the fix. */}
      {!isLoading && data && !data.profileReady && (
        <div className="panel">
          <EmptyState
            icon={<Plus />}
            title="Add a few more skills"
            description="We need at least three skills on your profile before matching means anything. It takes about a minute."
            action={
              <Button onClick={() => undefined} variant="secondary" disabled title="Coming next">
                Edit profile
              </Button>
            }
          />
        </div>
      )}

      {!isLoading && data?.profileReady && data.items.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Sparkles />}
            title="No strong matches yet"
            description="Nothing currently posted clears the relevance bar. Broaden your work-mode preferences or check back in a day or two."
          />
        </div>
      )}

      <ul className="flex flex-col gap-4">
        {data?.items.map((match, index) => (
          <MatchCard key={match.listing.id} match={match} index={index} />
        ))}
      </ul>
    </div>
  );
}

function scoreTone(score: number): { ring: string; text: string; label: string } {
  if (score >= 75) return { ring: 'text-success', text: 'text-success-fg', label: 'Strong match' };
  if (score >= 50) return { ring: 'text-brand', text: 'text-brand-fg', label: 'Good match' };
  return { ring: 'text-warning', text: 'text-warning-fg', label: 'Worth a look' };
}

function MatchCard({ match, index }: { match: MatchResult; index: number }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const tone = scoreTone(match.score);

  return (
    <motion.li
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.2), ease: [0.05, 0.7, 0.1, 1] }}
      className="panel p-4"
    >
      <div className="flex items-start gap-3">
        <Avatar
          name={match.company?.name ?? 'Company'}
          src={match.company?.logoUrl}
          size="md"
          shape="rounded"
          verified={match.company?.isVerified}
        />

        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-snug font-semibold text-fg">{match.listing.title}</h2>
          <p className="mt-0.5 truncate text-sm text-fg-muted">
            {match.company?.name ?? 'Unknown company'}
          </p>

          <ul className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
            <li className="flex items-center gap-1">
              <MapPin aria-hidden="true" className="size-3.5" />
              {match.listing.workMode === 'remote'
                ? 'Remote'
                : (match.listing.location ?? 'Location not stated')}
            </li>
            {match.listing.durationMonths && (
              <li className="flex items-center gap-1">
                <Timer aria-hidden="true" className="size-3.5" />
                {match.listing.durationMonths} months
              </li>
            )}
            {match.listing.publishedAt && <li>Posted {relativeTime(match.listing.publishedAt)}</li>}
          </ul>
        </div>

        <ScoreDial score={match.score} tone={tone} />
      </div>

      {match.highlights.length > 0 && (
        <ul className="mt-3.5 flex flex-col gap-1.5">
          {match.highlights.map((highlight) => (
            <li key={highlight} className="flex items-start gap-2 text-sm text-fg-muted">
              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
              {highlight}
            </li>
          ))}
        </ul>
      )}

      {match.missingSkills.length > 0 && (
        <p className="mt-2.5 text-xs text-fg-subtle">
          <span className="font-medium text-fg-muted">Not on your profile:</span>{' '}
          {match.missingSkills.slice(0, 4).join(', ')}
          {match.missingSkills.length > 4 && ` +${match.missingSkills.length - 4} more`}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-border-subtle pt-3">
        <Button size="sm" disabled title="Coming next">
          {match.hasApplied ? 'Applied' : 'Apply'}
        </Button>
        <Link
          to={`/roles/${match.listing.id}`}
          className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          View role
        </Link>

        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          aria-expanded={showBreakdown}
          className="ml-auto flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-fg-subtle transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          Why this score
          <ChevronDown
            aria-hidden="true"
            className={cn('size-3.5 transition-transform duration-[200ms]', showBreakdown && 'rotate-180')}
          />
        </button>
      </div>

      {showBreakdown && (
        <motion.dl
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.2, ease: [0.05, 0.7, 0.1, 1] }}
          className="mt-3 flex flex-col gap-2 overflow-hidden border-t border-border-subtle pt-3"
        >
          {match.breakdown.map((part) => (
            <div key={part.signal} className="flex items-center gap-3">
              <dt className="w-24 shrink-0 text-xs font-medium text-fg-muted capitalize">
                {part.signal === 'workMode' ? 'Work mode' : part.signal}
              </dt>
              <dd className="flex flex-1 items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-default"
                  role="img"
                  aria-label={`${part.signal}: ${Math.round(part.score * 100)} out of 100`}
                >
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-500"
                    style={{ width: `${Math.round(part.score * 100)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-2xs text-fg-faint tabular-nums">
                  {Math.round(part.weight * 100)}% weight
                </span>
              </dd>
            </div>
          ))}
        </motion.dl>
      )}
    </motion.li>
  );
}

function ScoreDial({
  score,
  tone,
}: {
  score: number;
  tone: { ring: string; text: string; label: string };
}) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div className="relative grid place-items-center" role="img" aria-label={`${tone.label}: ${score}%`}>
        <svg width={48} height={48} className="-rotate-90" aria-hidden="true">
          <circle cx={24} cy={24} r={radius} fill="none" stroke="var(--border-default)" strokeWidth={4} />
          <motion.circle
            cx={24}
            cy={24}
            r={radius}
            fill="none"
            className={tone.ring}
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - (score / 100) * circumference }}
            transition={{ type: 'spring', stiffness: 110, damping: 22 }}
          />
        </svg>
        <span className={cn('absolute text-xs font-bold tabular-nums', tone.text)}>{score}</span>
      </div>
      <span className={cn('text-2xs font-medium', tone.text)}>{tone.label}</span>
    </div>
  );
}
