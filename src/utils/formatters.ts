import type { CourseDescriptor, CourseId } from "../schemas/curriculum";
import type { EnrolledCourseConfig } from "../state/preferences";

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

export function computeDaysRemaining(
  isoDate: string,
  now = new Date()
): {
  days: number;
  label: string;
} | null {
  if (!isoDate) return null;
  const parts = isoDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;

  const target = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
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

export function formatPercentHuman(pct: number): string {
  const rounded = Math.round(pct * 2) / 2;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function roundHalfStep(val: number): number {
  return Math.round(val * 2) / 2;
}

export function normalizeCourseWeightsMap(
  enrolledCourses: Record<CourseId, EnrolledCourseConfig>
): Record<CourseId, number> {
  const active = Object.values(enrolledCourses).filter(
    (c) => c.status === "active"
  );
  if (active.length === 0) return {};
  if (active.length === 1) {
    return { [active[0].courseId]: 100 };
  }

  const rawSum = active.reduce(
    (sum, c) => sum + Math.max(0, c.weightPercent),
    0
  );
  const result: Record<CourseId, number> = {};

  if (rawSum <= 0) {
    const base = roundHalfStep(100 / active.length);
    let running = 0;
    active.forEach((c, idx) => {
      if (idx === active.length - 1) {
        result[c.courseId] = Math.max(0, roundHalfStep(100 - running));
      } else {
        result[c.courseId] = base;
        running += base;
      }
    });
    return result;
  }

  let running = 0;
  let largestCourseId = active[0].courseId;
  let largestVal = -1;

  for (const c of active) {
    const scaled = roundHalfStep((Math.max(0, c.weightPercent) / rawSum) * 100);
    result[c.courseId] = scaled;
    running += scaled;
    if (scaled > largestVal) {
      largestVal = scaled;
      largestCourseId = c.courseId;
    }
  }

  const residual = roundHalfStep(100 - running);
  if (residual !== 0) {
    result[largestCourseId] = Math.max(
      0,
      roundHalfStep((result[largestCourseId] ?? 0) + residual)
    );
  }

  return result;
}

export function rebalanceEnrolledCourses(
  enrolledCourses: Record<CourseId, EnrolledCourseConfig>
): Record<CourseId, EnrolledCourseConfig> {
  const normalized = normalizeCourseWeightsMap(enrolledCourses);
  const updated: Record<CourseId, EnrolledCourseConfig> = {};
  for (const [courseId, cfg] of Object.entries(enrolledCourses)) {
    updated[courseId] =
      cfg.status === "active" && normalized[courseId] !== undefined
        ? { ...cfg, weightPercent: normalized[courseId] }
        : cfg;
  }
  return updated;
}

export function updateCourseWeightWithRebalance(
  enrolledCourses: Record<CourseId, EnrolledCourseConfig>,
  targetCourseId: CourseId,
  requestedPercent: number,
  rebalanceLocked: boolean
): Record<CourseId, EnrolledCourseConfig> {
  const target = enrolledCourses[targetCourseId];
  if (!target || target.status !== "active") {
    return enrolledCourses;
  }

  const clamped = Math.min(100, Math.max(0, roundHalfStep(requestedPercent)));
  const activeIds = Object.values(enrolledCourses)
    .filter((c) => c.status === "active")
    .map((c) => c.courseId);

  if (activeIds.length <= 1) {
    return {
      ...enrolledCourses,
      [targetCourseId]: { ...target, weightPercent: 100 },
    };
  }

  if (activeIds.length === 2) {
    const otherId = activeIds.find((id) => id !== targetCourseId)!;
    const otherWeight = roundHalfStep(100 - clamped);
    return {
      ...enrolledCourses,
      [targetCourseId]: { ...target, weightPercent: clamped },
      [otherId]: {
        ...enrolledCourses[otherId],
        weightPercent: Math.max(0, otherWeight),
      },
    };
  }

  if (!rebalanceLocked) {
    return {
      ...enrolledCourses,
      [targetCourseId]: { ...target, weightPercent: clamped },
    };
  }

  const otherIds = activeIds.filter((id) => id !== targetCourseId);
  const remaining = Math.max(0, roundHalfStep(100 - clamped));
  const othersCurrentSum = otherIds.reduce(
    (sum, id) => sum + Math.max(0, enrolledCourses[id].weightPercent),
    0
  );

  const updated: Record<CourseId, EnrolledCourseConfig> = {
    ...enrolledCourses,
    [targetCourseId]: { ...target, weightPercent: clamped },
  };

  let allocated = 0;
  otherIds.forEach((id, index) => {
    if (index === otherIds.length - 1) {
      updated[id] = {
        ...enrolledCourses[id],
        weightPercent: Math.max(0, roundHalfStep(remaining - allocated)),
      };
    } else {
      const share =
        othersCurrentSum > 0
          ? (Math.max(0, enrolledCourses[id].weightPercent) /
              othersCurrentSum) *
            remaining
          : remaining / otherIds.length;
      const roundedShare = roundHalfStep(share);
      updated[id] = {
        ...enrolledCourses[id],
        weightPercent: roundedShare,
      };
      allocated += roundedShare;
    }
  });

  return updated;
}

export function applyTwoCoursePreset(
  enrolledCourses: Record<CourseId, EnrolledCourseConfig>,
  primaryCourseId: CourseId,
  primaryPercent: number
): Record<CourseId, EnrolledCourseConfig> {
  return updateCourseWeightWithRebalance(
    enrolledCourses,
    primaryCourseId,
    primaryPercent,
    true
  );
}

export function applyEqualSplitAcrossActive(
  enrolledCourses: Record<CourseId, EnrolledCourseConfig>
): Record<CourseId, EnrolledCourseConfig> {
  const zeroed: Record<CourseId, EnrolledCourseConfig> = {};
  for (const [id, cfg] of Object.entries(enrolledCourses)) {
    zeroed[id] = cfg.status === "active" ? { ...cfg, weightPercent: 0 } : cfg;
  }
  return rebalanceEnrolledCourses(zeroed);
}

export function resolveCourseDisplayName(
  courseId: CourseId,
  descriptor?: Pick<CourseDescriptor, "name" | "variants"> | null,
  activeVariantId?: string
): string {
  if (!descriptor) {
    return courseId.toUpperCase();
  }
  if (activeVariantId && descriptor.variants) {
    const variant = descriptor.variants.find((v) => v.id === activeVariantId);
    if (variant) {
      return variant.label;
    }
  }
  return descriptor.name;
}

export interface CourseWeeklyAllocation {
  courseId: CourseId;
  name: string;
  weightPercent: number;
  weeklyHours: number;
  hoursLabel: string;
}

export function computeMultiCourseWeeklyHours(
  sessionsPerDay: number,
  sessionMinutes: number,
  activeCourses: Array<{
    courseId: CourseId;
    name: string;
    weightPercent: number;
  }>
): {
  totalWeeklyHours: number;
  allocations: CourseWeeklyAllocation[];
} {
  const totalWeeklyHours = (sessionsPerDay * sessionMinutes * 7) / 60;
  const totalWeight = activeCourses.reduce(
    (sum, c) => sum + Math.max(0, c.weightPercent),
    0
  );

  const fmtHours = (val: number) =>
    Number.isInteger(val) ? String(val) : val.toFixed(1);

  const allocations: CourseWeeklyAllocation[] = activeCourses.map((course) => {
    const normalizedPct =
      totalWeight > 0
        ? (Math.max(0, course.weightPercent) / totalWeight) * 100
        : 100 / Math.max(1, activeCourses.length);
    const rawHours = totalWeeklyHours * (normalizedPct / 100);
    const weeklyHours = roundHalfStep(rawHours);
    return {
      courseId: course.courseId,
      name: course.name,
      weightPercent: roundHalfStep(normalizedPct),
      weeklyHours,
      hoursLabel: `${fmtHours(weeklyHours)} hrs/wk ${course.name}`,
    };
  });

  return { totalWeeklyHours, allocations };
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
  courseId: CourseId;
  courseLabel: string;
  durationMinutes: number;
  title: string;
  subtitle: string;
}

export interface HomeworkChecklistItem {
  id: string;
  courseId: CourseId | "all";
  minutes: number;
  label: string;
}

export function getMondayBasedDayIndex(date = new Date()): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export interface ScheduleCourseInput {
  courseId: CourseId;
  name: string;
  displayLabel: string;
  weightPercent: number;
  hasScriptGrids?: boolean;
}

export function buildDynamicDaySchedule(
  dayIndex: number,
  sessionsPerDay: number,
  sessionMinutes: number,
  dailyPracticeMinutes: number,
  activeCourses: ScheduleCourseInput[]
): {
  sessions: ScheduledFocusBlock[];
  homework: HomeworkChecklistItem[];
} {
  if (activeCourses.length === 0 || sessionsPerDay <= 0) {
    return { sessions: [], homework: [] };
  }

  const totalWeeklySlots = sessionsPerDay * 7;
  const weightSum = activeCourses.reduce(
    (s, c) => s + Math.max(0, c.weightPercent),
    0
  );
  const normalized = activeCourses.map((c) => ({
    ...c,
    ratio:
      weightSum > 0
        ? Math.max(0, c.weightPercent) / weightSum
        : 1 / activeCourses.length,
  }));

  // Largest-remainder slot allocation ensuring every positive-weight course gets >= 1 weekly slot when slots permit
  const quotas = normalized.map((c) => ({
    course: c,
    exact: c.ratio * totalWeeklySlots,
    slots: Math.floor(c.ratio * totalWeeklySlots),
  }));

  if (totalWeeklySlots >= quotas.length) {
    for (const q of quotas) {
      if (q.course.ratio > 0 && q.slots === 0) {
        q.slots = 1;
      }
    }
  }

  let currentTotal = quotas.reduce((s, q) => s + q.slots, 0);
  while (currentTotal > totalWeeklySlots) {
    quotas.sort((a, b) => b.slots - a.slots);
    if (quotas[0].slots > 1) {
      quotas[0].slots -= 1;
      currentTotal -= 1;
    } else {
      break;
    }
  }

  if (currentTotal < totalWeeklySlots) {
    const byRemainder = [...quotas].sort(
      (a, b) => b.exact - b.slots - (a.exact - a.slots)
    );
    let idx = 0;
    while (currentTotal < totalWeeklySlots) {
      byRemainder[idx % byRemainder.length].slots += 1;
      currentTotal += 1;
      idx += 1;
    }
  }

  // Smoothly interleave weekly slots using Bresenham-style accumulator across 0..totalWeeklySlots-1
  const accumulators = quotas.map((q) => ({
    course: q.course,
    remaining: q.slots,
    totalQuota: q.slots,
    score: q.slots / Math.max(1, totalWeeklySlots),
  }));

  const weeklyTimeline: ScheduleCourseInput[] = [];
  for (let slot = 0; slot < totalWeeklySlots; slot += 1) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < accumulators.length; i += 1) {
      const acc = accumulators[i];
      if (acc.remaining <= 0) continue;
      if (acc.score > bestScore) {
        bestScore = acc.score;
        bestIdx = i;
      }
    }
    const chosen = accumulators[bestIdx];
    weeklyTimeline.push(chosen.course);
    chosen.remaining -= 1;
    chosen.score -= 1;
    for (const acc of accumulators) {
      acc.score += acc.totalQuota / Math.max(1, totalWeeklySlots);
    }
  }

  const focusThemes = [
    "Guided Pattern Studio & Transformation Drills",
    "Hands-Free Audio Shadowing & Speaking Loop",
    "Contextual Listening & Active Recall",
  ];

  const sessions: ScheduledFocusBlock[] = [];
  for (let s = 0; s < sessionsPerDay; s += 1) {
    const globalSlot = dayIndex * sessionsPerDay + s;
    const assigned = weeklyTimeline[globalSlot] ?? activeCourses[0];
    sessions.push({
      index: s,
      courseId: assigned.courseId,
      courseLabel: assigned.displayLabel,
      durationMinutes: sessionMinutes,
      title: `Focus Session ${s + 1} · ${assigned.displayLabel}`,
      subtitle: focusThemes[(s + dayIndex) % focusThemes.length],
    });
  }

  const srsMins = Math.max(10, Math.round(dailyPracticeMinutes * 0.4));
  const storyMins = Math.max(10, Math.round(dailyPracticeMinutes * 0.4));
  const refMins = Math.max(5, dailyPracticeMinutes - srsMins - storyMins);

  const storyCourse =
    weeklyTimeline[
      (dayIndex * sessionsPerDay + (sessionsPerDay - 1)) %
        Math.max(1, weeklyTimeline.length)
    ] ?? activeCourses[0];
  const primaryCourse = activeCourses[0];

  const homework: HomeworkChecklistItem[] = [
    {
      id: `day-${dayIndex}-hw-srs`,
      courseId: "all",
      minutes: srsMins,
      label: `Clear due Practice flashcards (${srsMins}m)`,
    },
    {
      id: `day-${dayIndex}-hw-story`,
      courseId: storyCourse.courseId,
      minutes: storyMins,
      label: `Read one ${storyCourse.name} Graded Story aloud (${storyMins}m)`,
    },
    {
      id: `day-${dayIndex}-hw-ref`,
      courseId: primaryCourse.courseId,
      minutes: refMins,
      label: primaryCourse.hasScriptGrids
        ? `Review ${primaryCourse.name} character soundboard or Reference sheets (${refMins}m)`
        : `Review ${primaryCourse.name} Reference patterns & phrases (${refMins}m)`,
    },
  ];

  return { sessions, homework };
}
