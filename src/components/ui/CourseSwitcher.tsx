import { ChevronDown } from "lucide-react";
import { SegmentedControl, type SegmentOption } from "./SegmentedControl";

export function CourseSwitcher<T extends string>({
  id,
  options,
  value,
  onChange,
  ariaLabel,
  compact = false,
}: {
  id: string;
  options: ReadonlyArray<SegmentOption<T> & { textLabel?: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  compact?: boolean;
}) {
  if (options.length <= 3) {
    return (
      <SegmentedControl<T>
        id={id}
        options={options}
        value={value}
        onChange={onChange}
        ariaLabel={ariaLabel}
        compact={compact}
      />
    );
  }

  return (
    <div className="relative w-full">
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={`w-full appearance-none rounded-xl bg-[var(--bg-inset)] pl-3.5 pr-9 font-semibold text-[var(--ink-primary)] focus:outline-none ${
          compact ? "min-h-[40px] text-[13px]" : "min-h-[44px] text-[14px]"
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.textLabel ??
              (typeof opt.label === "string" ? opt.label : String(opt.value))}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-secondary)]"
        strokeWidth={1.9}
      />
    </div>
  );
}
