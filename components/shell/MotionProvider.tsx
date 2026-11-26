'use client';
// Makes every motion/react animation in the app respect prefers-reduced-motion.
import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
