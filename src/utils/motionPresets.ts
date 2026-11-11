import type { Transition } from "motion/react";

export const SEGMENT_SPRING: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 32,
  mass: 1,
};

export const SHEET_SPRING: Transition = {
  type: "spring",
  stiffness: 360,
  damping: 32,
  mass: 0.8,
};

export const POPOVER_TRANSITION: Transition = {
  duration: 0.16,
  ease: [0.25, 1, 0.5, 1],
};

export const CARD_REVEAL_TRANSITION: Transition = {
  duration: 0.15,
  ease: [0.25, 1, 0.5, 1],
};

export const INSTANT_TRANSITION: Transition = {
  duration: 0.01,
};

export function resolveTransition(
  prefersReducedMotion: boolean | null,
  standardTransition: Transition
): Transition {
  return prefersReducedMotion ? INSTANT_TRANSITION : standardTransition;
}
