import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { LoginSchema, type LoginInput } from '@internlink/shared-types';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { Alert, Divider } from '@/components/ui/feedback';
import { mapFirebaseAuthError } from '@/lib/api-client';
import { useGoogleSignIn, useSignIn } from './use-auth';
import { AuthLayout, GoogleIcon } from './auth-layout';

export function SignInScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const [formError, setFormError] = useState<string | null>(null);

  // Where the guard bounced them from, so they land back on the page they
  // asked for rather than a generic home screen.
  const returnTo = (location.state as { from?: string } | null)?.from ?? '/';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  async function onSubmit(values: LoginInput): Promise<void> {
    setFormError(null);
    try {
      await signIn.mutateAsync(values);
      navigate(returnTo, { replace: true });
    } catch (error) {
      const mapped = mapFirebaseAuthError(error);
      if (mapped.message) setFormError(mapped.message);
    }
  }

  async function handleGoogle(): Promise<void> {
    setFormError(null);
    try {
      await googleSignIn.mutateAsync();
      navigate(returnTo, { replace: true });
    } catch (error) {
      const mapped = mapFirebaseAuthError(error);
      if (mapped.message) setFormError(mapped.message);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <p className="text-center text-sm text-fg-muted">
          New to InternLink?{' '}
          <Link
            to="/sign-up"
            className="font-semibold text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <Button
        variant="outline"
        size="lg"
        fullWidth
        onClick={handleGoogle}
        isLoading={googleSignIn.isPending}
        loadingText="Opening Google…"
        leftIcon={<GoogleIcon className="size-4.5" />}
      >
        Continue with Google
      </Button>

      <Divider label="or" className="my-6" />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError && <Alert variant="error">{formError}</Alert>}

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
            enterKeyHint="next"
            autoFocus
          />
        </Field>

        <Field
          label="Password"
          error={errors.password?.message}
          required
          labelAccessory={
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            {...register('password')}
            autoComplete="current-password"
            placeholder="Your password"
            enterKeyHint="done"
          />
        </Field>

        <Checkbox {...register('rememberMe')} label="Keep me signed in on this device" />

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isSubmitting || signIn.isPending}
          loadingText="Signing you in…"
          className="mt-1"
        >
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
