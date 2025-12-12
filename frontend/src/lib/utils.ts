'use client';

import clsx, { type ClassValue } from 'clsx';

// Simple cn utility - combines clsx for now
// TODO: Add tailwind-merge for proper Tailwind class deduplication
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
