
import { twMerge } from 'tailwind-merge';

type ClassValue = string | false | null | undefined;

/** Small class-name joiner with tailwind-merge conflict resolution. */
export function cn(...classes: ClassValue[]): string {
  return twMerge(classes.filter(Boolean).join(' '));
}