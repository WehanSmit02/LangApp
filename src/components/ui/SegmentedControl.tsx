import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { resolveTransition, SEGMENT_SPRING } from "../../utils/motionPresets";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  id,
  options,
  value,
  onChange,
  ariaLabel,
  compact = false,
}: {
  id: string;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  compact?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const transition = resolveTransition(prefersReducedMotion, SEGMENT_SPRING);

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative flex w-full items-center rounded-xl bg-[var(--bg-inset)] p-1 min-w-0"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex-1 min-w-0 select-none rounded-[9px] px-2.5 text-center font-medium transition-colors ${
              compact ? "min-h-[38px] text-[13px]" : "min-h-[44px] text-[14px]"
            } ${
              active
                ? "text-[var(--ink-primary)] font-semibold"
                : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`${id}-pill`}
                transition={transition}
                className="absolute inset-0 -z-10 rounded-[9px] bg-[var(--bg-elevated)] shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
              />
            )}
            <span className="block truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
