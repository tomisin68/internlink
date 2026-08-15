import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, with later Tailwind utilities beating earlier ones.
 *
 * Without twMerge, `cn('px-4', props.className)` where className is `px-6`
 * produces `px-4 px-6` and the winner depends on CSS source order — which is
 * how a component ends up ignoring the padding a caller passed it.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
