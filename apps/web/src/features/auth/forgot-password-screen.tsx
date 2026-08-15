import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Mail, MailCheck } from 'lucide-react';
import { PasswordResetRequestSchema, type PasswordResetRequestInput } from '@internlink/shared-types';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { usePasswordReset } from './use-auth';
import { AuthLayout } from './auth-layout';

export function ForgotPasswordScreen() {
  const navigate = useNavigate();
  const reset = usePasswordReset();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(PasswordResetRequestSchema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  async function onSubmit(values: PasswordResetRequestInput): Promise<void> {
    try {
      await reset.mutateAsync(values.email);
    } catch {
      // Swallowed on purpose. Firebase returns `auth/user-not-found` for an
      // unknown address, and surfacing that difference turns this form into an
      // account-enumeration oracle. Both outcomes show the same confirmation.
    }
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle={
          <>
            If an account exists for <span className="font-medium text-fg">{sentTo}</span>, we have
            sent a link to reset the password. It expires in an hour.
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-center rounded-2xl border border-border-subtle bg-brand-subtle py-10">
            <MailCheck aria-hidden="true" className="size-11 text-brand" strokeWidth={1.5} />
          </div>

          <Alert variant="info" title="Not arrived?">
            Give it a couple of minutes, then check your spam folder. You can also{' '}
            <button
              type="button"
              onClick={() => void onSubmit({ email: getValues('email') })}
              className="cursor-pointer font-semibold text-brand-fg underline underline-offset-4"
            >
              send it again
            </button>
            .
          </Alert>

          <Button variant="outline" size="lg" fullWidth onClick={() => navigate('/sign-in')}>
            Back to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email on your account and we'll send you a link to set a new password."
      footer={
        <Link
          to="/sign-in"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <Field label="Email" error={errors.email?.message} required>
          <Input
            {...register('email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            leftIcon={<Mail />}
            enterKeyHint="send"
            autoFocus
          />
        </Field>

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isSubmitting || reset.isPending}
          loadingText="Sending the link…"
        >
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
