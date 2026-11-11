import { motion, useReducedMotion } from "motion/react";
import { resolveTransition, SEGMENT_SPRING } from "../../utils/motionPresets";

export function SwitchToggle({
  id,
  checked,
  onChange,
  ariaLabel,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const transition = resolveTransition(prefersReducedMotion, SEGMENT_SPRING);

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-[44px] min-w-[52px] shrink-0 items-center justify-end"
    >
      <span
        className={`relative inline-flex h-[31px] w-[51px] items-center rounded-full p-[2px] transition-colors duration-150 ${
          checked
            ? "bg-[var(--accent)]"
            : "bg-black/15 dark:bg-white/20"
        }`}
      >
        <motion.span
          layout
          transition={transition}
          className={`h-[27px] w-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.24)] ${
            checked ? "ml-auto" : "mr-auto"
          }`}
        />
      </span>
    </button>
  );
}
