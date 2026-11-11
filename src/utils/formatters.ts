import type { LanguageCode } from "../schemas/curriculum";

const mediumDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatBytesHuman(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1).replace(/\.0$/, "") : Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function formatGoalDateHuman(isoDate: string): string {
  if (!isoDate) return "";
  const parts = isoDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "";
  const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
  return mediumDateFormatter.format(localDate);
}

export function computeDaysRemaining(isoDate: string, now = new Date()): {
  days: number;
  label: string;
} | null {
  if (!isoDate) return null;
  const parts = isoDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;

  const target = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (target.getTime() - startOfToday.getTime()) / 86_400_000
  );

  if (diffDays < 0) {
    return { days: 0, label: "Goal date reached" };
  }
  if (diffDays === 0) {
    return { days: 0, label: "Today" };
  }
  if (diffDays === 1) {
    return { days: 1, label: "1 day left" };
  }
  return { days: diffDays, label: `${diffDays} days left` };
}

export function formatTimerClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function computeWeeklyHoursSplit(
  sessionsPerDay: number,
  sessionMinutes: number,
  japaneseSplitPercent: number
): {
  totalWeeklyHours: number;
  jaHoursLabel: string;
  deHoursLabel: string;
} {
  const totalWeeklyHours = (sessionsPerDay * sessionMinutes * 7) / 60;
  const rawJa = totalWeeklyHours * (japaneseSplitPercent / 100);
  const roundedJa = Math.round(rawJa * 2) / 2;
  const roundedDe = Math.max(0, Math.round((totalWeeklyHours - roundedJa) * 2) / 2);

  const fmt = (val: number) =>
    Number.isInteger(val) ? String(val) : val.toFixed(1);

  return {
    totalWeeklyHours,
    jaHoursLabel: `${fmt(roundedJa)} hrs/wk JP`,
    deHoursLabel: `${fmt(roundedDe)} hrs/wk DE`,
  };
}

export const WEEKDAY_LABELS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export interface ScheduledFocusBlock {
  index: number;
  language: LanguageCode;
  durationMinutes: number;
  title: string;
  subtitle: string;
}

export interface HomeworkChecklistItem {
  id: string;
  language: LanguageCode | "both";
  minutes: number;
  label: string;
}

export function getMondayBasedDayIndex(date = new Date()): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function buildDaySchedule(
  dayIndex: number,
  sessionsPerDay: number,
  sessionMinutes: number,
  dailyPracticeMinutes: number,
  japaneseSplitPercent: number,
  austrianMode: boolean
): {
  sessions: ScheduledFocusBlock[];
  homework: HomeworkChecklistItem[];
} {
  const totalWeeklySlots = sessionsPerDay * 7;
  const deWeeklySlots =
    japaneseSplitPercent >= 100
      ? 0
      : japaneseSplitPercent <= 0
      ? totalWeeklySlots
      : Math.max(
          1,
          Math.round(totalWeeklySlots * ((100 - japaneseSplitPercent) / 100))
        );

  const deSlotPositions = new Set<number>();
  if (deWeeklySlots > 0) {
    const stride = totalWeeklySlots / deWeeklySlots;
    for (let k = 0; k < deWeeklySlots; k += 1) {
      const slot = Math.min(
        totalWeeklySlots - 1,
        Math.floor((k + 0.5) * stride)
      );
      deSlotPositions.add(slot);
    }
  }

  const deRegionLabel = austrianMode ? "Austrian German" : "German";
  const sessions: ScheduledFocusBlock[] = [];

  for (let s = 0; s < sessionsPerDay; s += 1) {
    const globalSlot = dayIndex * sessionsPerDay + s;
    const isDe = deSlotPositions.has(globalSlot);
    const language: LanguageCode = isDe ? "de" : "ja";

    const focusThemesJa = [
      "Guided Pattern Studio & Transformation Drills",
      "Hands-Free Audio Shadowing & Speaking Loop",
      "Contextual Listening & Active Recall",
    ];
    const focusThemesDe = [
      `${deRegionLabel} Survival Patterns & Compound Roots`,
      `${deRegionLabel} Hands-Free Speaking & Transit Scenarios`,
      `${deRegionLabel} Listening & Polite Requests`,
    ];

    sessions.push({
      index: s,
      language,
      durationMinutes: sessionMinutes,
      title: `Focus Session ${s + 1} · ${language === "ja" ? "Japanese" : deRegionLabel}`,
      subtitle: isDe
        ? focusThemesDe[s % focusThemesDe.length]
        : focusThemesJa[s % focusThemesJa.length],
    });
  }

  const srsMins = Math.max(10, Math.round(dailyPracticeMinutes * 0.4));
  const storyMins = Math.max(10, Math.round(dailyPracticeMinutes * 0.4));
  const refMins = Math.max(5, dailyPracticeMinutes - srsMins - storyMins);

  const homework: HomeworkChecklistItem[] = [
    {
      id: `day-${dayIndex}-hw-srs`,
      language: "both",
      minutes: srsMins,
      label: `Clear due Practice flashcards (${srsMins}m)`,
    },
    {
      id: `day-${dayIndex}-hw-story`,
      language: dayIndex === 2 || dayIndex === 5 ? "de" : "ja",
      minutes: storyMins,
      label: `Read one level-matched Graded Story aloud (${storyMins}m)`,
    },
    {
      id: `day-${dayIndex}-hw-ref`,
      language: japaneseSplitPercent >= 50 ? "ja" : "de",
      minutes: refMins,
      label: `Review Kana soundboard or Reference patterns (${refMins}m)`,
    },
  ];

  return { sessions, homework };
}
