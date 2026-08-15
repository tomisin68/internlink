import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail, User } from 'lucide-react';
import { RegisterFormSchema, type RegisterFormInput } from '@internlink/shared-types';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { Alert, Divider } from '@/components/ui/feedback';
import { mapFirebaseAuthError } from '@/lib/api-client';
import { useGoogleSignIn, useSignUp } from './use-auth';
import { AuthLayout, GoogleIcon } from './auth-layout';

export function SignUpScreen() {
  const navigate = useNavigate();
  const signUp = useSignUp();
  const googleSignIn = useGoogleSignIn();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormInput>({
    resolver: zodResolver(RegisterFormSchema),
    // Validate on blur, then keep re-validating on change once a field has
    // already failed. Validating on every keystroke from the start shouts at
    // people for a half-typed email they were always going to finish.
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      intendedRole: 'intern',
      acceptedTerms: false as unknown as true,
    },
  });

  const password = watch('password');

  async function onSubmit(values: RegisterFormInput): Promise<void> {
    setFormError(null);
    try {
      await signUp.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
      });
      // The session's `nextStep` is `select_role` for a brand-new account, and
      // the route guard will redirect there. Navigating to the root keeps that
      // decision in one place.
      navigate('/', { replace: true });
    } catch (error) {
      const mapped = mapFirebaseAuthError(error);
      if (mapped.fields) {
        for (const [field, messages] of Object.entries(mapped.fields)) {
          setError(field as keyof RegisterFormInput, { message: messages[0] });
        }
      }
      if (mapped.message) setFormError(mapped.message);
    }
  }

  async function handleGoogle(): Promise<void> {
    setFormError(null);
    try {
      await googleSignIn.mutateAsync();
      navigate('/', { replace: true });
    } catch (error) {
      const mapped = mapFirebaseAuthError(error);
      if (mapped.message) setFormError(mapped.message);
    }
  }

  const isBusy = isSubmitting || signUp.isPending;

  return (
    <AuthLayout
      title="Create your account"
      subtitle="One account, both sides of the table. Start as an intern or a recruiter — you can add the other later."
      footer={
        <p className="text-center text-sm text-fg-muted">
          Already have an account?{' '}
          <Link
            to="/sign-in"
            className="font-semibold text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Sign in
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

        {/* Two columns on anything above a small phone; stacked below, because
            two 140px-wide name fields side by side are worse than one each. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={errors.firstName?.message} required>
            <Input
              {...register('firstName')}
              autoComplete="given-name"
              autoCapitalize="words"
              placeholder="Ada"
              leftIcon={<User />}
              enterKeyHint="next"
            />
          </Field>

          <Field label="Last name" error={errors.lastName?.message} required>
            <Input
              {...register('lastName')}
              autoComplete="family-name"
              autoCapitalize="words"
              placeholder="Okonkwo"
              enterKeyHint="next"
            />
          </Field>
        </div>

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
          />
        </Field>

        <Field
          label="Password"
          error={errors.password?.message}
          hint="At least 10 characters, with a number or symbol."
          required
        >
          <PasswordInput
            {...register('password')}
            value={password}
            showStrength
            autoComplete="new-password"
            placeholder="Create a password"
            enterKeyHint="next"
          />
        </Field>

        <Field label="Confirm password" error={errors.confirmPassword?.message} required>
          <PasswordInput
            {...register('confirmPassword')}
            autoComplete="new-password"
            placeholder="Type it again"
            enterKeyHint="done"
          />
        </Field>

        <Checkbox
          {...register('acceptedTerms')}
          error={errors.acceptedTerms?.message}
          label={
            <>
              I agree to the{' '}
              <Link to="/terms" className="font-medium text-brand-fg underline underline-offset-4">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="font-medium text-brand-fg underline underline-offset-4">
                Privacy Policy
              </Link>
              , including the{' '}
              <Link to="/guidelines" className="font-medium text-brand-fg underline underline-offset-4">
                Community Guidelines
              </Link>
              .
            </>
          }
        />

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isBusy}
          loadingText="Creating your account…"
          className="mt-1"
        >
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
