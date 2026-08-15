import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Clock, MessageSquare, UserCheck, UserPlus } from 'lucide-react';
import type { PersonSummary } from '@internlink/shared-types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { messagingApi, networkApi } from '@/lib/api-endpoints';
import { toast } from '@/lib/stores';
import { ApiRequestError } from '@/lib/api-client';

/**
 * One person in a list, with whichever action their relationship calls for.
 *
 * Follow sits alongside Connect rather than replacing it: they are different
 * relationships, and someone who wants a recruiter's posts should not have to
 * file a connection request to get them.
 */
export function PersonRow({ person }: { person: PersonSummary }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['network'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
  }

  const connect = useMutation({
    mutationFn: () => networkApi.connect(person.id),
    onSuccess: () => {
      refresh();
      toast.success('Request sent', `${person.displayName} will see it in their requests.`);
    },
    onError: (error) => {
      toast.error(
        'Could not send that request',
        error instanceof ApiRequestError ? error.message : 'Try again in a moment.',
      );
    },
  });

  const accept = useMutation({
    mutationFn: () => networkApi.respond(person.connectionId!, true),
    onSuccess: () => {
      refresh();
      toast.success('Connected');
    },
    onError: () => toast.error('Could not accept that request'),
  });

  const toggleFollow = useMutation({
    mutationFn: () =>
      person.isFollowing
        ? networkApi.unfollowAccount(person.id)
        : networkApi.followAccount(person.id),
    onSuccess: (result) => {
      refresh();
      if (person.isFollowing) {
        toast.success(`Unfollowed ${person.displayName}`);
        return;
      }
      // Reciprocating is the interesting part, so it gets its own line rather
      // than the flatter "Following Ada".
      toast.success(
        'mutual' in result && result.mutual
          ? `You and ${person.displayName} now follow each other`
          : `Following ${person.displayName}`,
        'mutual' in result && result.mutual
          ? 'Their posts will show up in your feed.'
          : undefined,
      );
    },
    onError: () => toast.error('Could not change that'),
  });

  const message = useMutation({
    mutationFn: () =>
      messagingApi.startThread({ recipientId: person.id, body: 'Hi — good to be connected.' }),
    onSuccess: (result) => navigate(`/messages/${result.thread.id}`),
    onError: () => toast.error('Could not open a conversation'),
  });

  const subtitle =
    person.headline ??
    [person.companyName, person.location].filter(Boolean).join(' · ') ??
    person.activeRole;

  // "Follow back" is a materially easier decision than "Follow", and saying so
  // is the difference between a prompt and a chore.
  const followLabel = person.isFollowing
    ? 'Following'
    : person.followsYou
      ? 'Follow back'
      : 'Follow';

  return (
    <li className="panel flex items-center gap-3 p-3">
      <Link
        to={`/u/${person.id}`}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        <Avatar
          name={person.displayName}
          src={person.photoUrl}
          size="md"
          verified={person.isVerified}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg group-hover:underline">
            {person.displayName}
          </p>
          <p className="truncate text-xs text-fg-subtle">{subtitle || person.activeRole}</p>
          <p className="truncate text-2xs text-fg-faint">
            {person.mutualConnections > 0 &&
              `${person.mutualConnections} mutual ${person.mutualConnections === 1 ? 'connection' : 'connections'}`}
            {person.mutualConnections > 0 && person.followsYou && ' · '}
            {person.followsYou && !person.isFollowing && 'Follows you'}
          </p>
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-1.5">
        {person.relationship === 'connected' ? (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<MessageSquare />}
            isLoading={message.isPending}
            onClick={() => message.mutate()}
          >
            <span className="hidden sm:inline">Message</span>
          </Button>
        ) : (
          <Button
            size="sm"
            variant={person.isFollowing ? 'outline' : person.followsYou ? 'secondary' : 'ghost'}
            isLoading={toggleFollow.isPending}
            onClick={() => toggleFollow.mutate()}
          >
            {followLabel}
          </Button>
        )}

        <ConnectAction
          person={person}
          onConnect={() => connect.mutate()}
          onAccept={() => accept.mutate()}
          isBusy={connect.isPending || accept.isPending}
        />
      </div>
    </li>
  );
}

function ConnectAction({
  person,
  onConnect,
  onAccept,
  isBusy,
}: {
  person: PersonSummary;
  onConnect: () => void;
  onAccept: () => void;
  isBusy: boolean;
}) {
  switch (person.relationship) {
    case 'connected':
      return (
        <span
          className="flex items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg-subtle"
          title="You are connected"
        >
          <UserCheck aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Connected</span>
        </span>
      );

    case 'pending_outgoing':
      return (
        <span
          className="flex items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg-subtle"
          title="Waiting on their answer"
        >
          <Clock aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Pending</span>
        </span>
      );

    case 'pending_incoming':
      return (
        <Button size="sm" leftIcon={<Check />} isLoading={isBusy} onClick={onAccept}>
          Accept
        </Button>
      );

    case 'self':
    case 'blocked':
      return null;

    default:
      return (
        <Button size="sm" leftIcon={<UserPlus />} isLoading={isBusy} onClick={onConnect}>
          <span className="hidden sm:inline">Connect</span>
        </Button>
      );
  }
}
