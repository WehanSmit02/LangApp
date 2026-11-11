import {
  ArrowUpRight,
  BookOpen,
  Calendar,
  Check,
  Layers,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { recordFocusMinutes, toggleHomeworkCheck } from "../db/offlineDb";
import { TIER_META } from "../schemas/curriculum";
import { buildWeightedReviewQueue } from "../services/sm2";
import {
  getOrderedEnrolledCourses,
  type UserPreferences,
} from "../state/preferences";
import {
  notifyOfflineDbChanged,
  type OfflineLibraryHandle,
} from "../state/useOfflineLibrary";
import {
  buildDynamicDaySchedule,
  computeDaysRemaining,
  computeMultiCourseWeeklyHours,
  formatGoalDateHuman,
  formatTimerClock,
  getMondayBasedDayIndex,
  normalizeCourseWeightsMap,
  resolveCourseDisplayName,
  WEEKDAY_LABELS,
} from "../utils/formatters";
import { resolveTransition, SEGMENT_SPRING } from "../utils/motionPresets";

const BAR_SEGMENT_CLASSES = [
  "bg-[var(--accent)]",
  "bg-black/25 dark:bg-white/35",
  "bg-black/45 dark:bg-white/55",
  "bg-black/15 dark:bg-white/20",
] as const;

export function TodayView({
  prefs,
  library,
  onNavigateTab,
  onOpenUnit,
  onOpenSettings,
}: {
  prefs: UserPreferences;
  library: OfflineLibraryHandle;
  onNavigateTab: (tab: "courses" | "practice" | "stories") => void;
  onOpenUnit: (unitId: string) => void;
  onOpenSettings: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const springTransition = resolveTransition(
    prefersReducedMotion,
    SEGMENT_SPRING
  );

  const todayIndex = getMondayBasedDayIndex();
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(todayIndex);
  const [activeSessionIdx, setActiveSessionIdx] = useState<number>(0);

  const totalSessionSeconds = prefs.focusSessionMinutes * 60;
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [timerAnnouncement, setTimerAnnouncement] = useState<string>("");
  const loggedMinutesRef = useRef<number>(0);

  const remainingSeconds = Math.max(0, totalSessionSeconds - elapsedSeconds);

  useEffect(() => {
    if (!isRunning) return;

    const interval = window.setInterval(() => {
      setElapsedSeconds((prev) => {
        const nextElapsed = prev + 1;
        if (nextElapsed >= totalSessionSeconds) {
          window.clearInterval(interval);
          setIsRunning(false);
          const unlogged = Math.max(
            1,
            prefs.focusSessionMinutes - loggedMinutesRef.current
          );
          loggedMinutesRef.current = prefs.focusSessionMinutes;
          void recordFocusMinutes(unlogged, activeSessionIdx).then(() => {
            notifyOfflineDbChanged();
          });
          setTimerAnnouncement("Focus session completed.");
          return totalSessionSeconds;
        }

        const elapsedWholeMinutes = Math.floor(nextElapsed / 60);
        if (elapsedWholeMinutes > loggedMinutesRef.current) {
          const diff = elapsedWholeMinutes - loggedMinutesRef.current;
          loggedMinutesRef.current = elapsedWholeMinutes;
          void recordFocusMinutes(diff).then(() => {
            notifyOfflineDbChanged();
          });
        }
        return nextElapsed;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    isRunning,
    activeSessionIdx,
    prefs.focusSessionMinutes,
    totalSessionSeconds,
  ]);

  const activeEnrollments = useMemo(
    () => getOrderedEnrolledCourses(prefs.enrolledCourses, "active"),
    [prefs.enrolledCourses]
  );

  const normalizedWeights = useMemo(
    () => normalizeCourseWeightsMap(prefs.enrolledCourses),
    [prefs.enrolledCourses]
  );

  const activeCourseInputs = useMemo(
    () =>
      activeEnrollments.map((enrollment) => {
        const descriptor = library.descriptorsByCourseId.get(
          enrollment.courseId
        );
        const manifestEntry = library.manifestCourseMap.get(
          enrollment.courseId
        );
        const displayLabel = resolveCourseDisplayName(
          enrollment.courseId,
          descriptor,
          enrollment.activeVariantId
        );
        return {
          courseId: enrollment.courseId,
          name: descriptor?.name ?? displayLabel,
          displayLabel,
          weightPercent:
            normalizedWeights[enrollment.courseId] ?? enrollment.weightPercent,
          hasScriptGrids: Boolean(
            descriptor?.scriptGrids?.length ||
              manifestEntry?.descriptor.hasScriptGrids
          ),
          tier: enrollment.tier,
          goalDate: enrollment.goalDate,
        };
      }),
    [
      activeEnrollments,
      library.descriptorsByCourseId,
      library.manifestCourseMap,
      normalizedWeights,
    ]
  );

  const weeklyAllocation = useMemo(
    () =>
      computeMultiCourseWeeklyHours(
        prefs.focusSessionsPerDay,
        prefs.focusSessionMinutes,
        activeCourseInputs.map((c) => ({
          courseId: c.courseId,
          name: c.displayLabel,
          weightPercent: c.weightPercent,
        }))
      ),
    [
      prefs.focusSessionsPerDay,
      prefs.focusSessionMinutes,
      activeCourseInputs,
    ]
  );

  const daySchedule = useMemo(
    () =>
      buildDynamicDaySchedule(
        selectedDayIndex,
        prefs.focusSessionsPerDay,
        prefs.focusSessionMinutes,
        prefs.dailyPracticeMinutes,
        activeCourseInputs
      ),
    [
      selectedDayIndex,
      prefs.focusSessionsPerDay,
      prefs.focusSessionMinutes,
      prefs.dailyPracticeMinutes,
      activeCourseInputs,
    ]
  );

  const [todayMountMs] = useState<number>(() => Date.now());

  const dueQueueCount = useMemo(
    () =>
      buildWeightedReviewQueue(
        library.eligibleCards,
        library.reviewByCardId,
        normalizedWeights,
        todayMountMs
      ).length,
    [
      library.eligibleCards,
      library.reviewByCardId,
      normalizedWeights,
      todayMountMs,
    ]
  );

  const nextInstalledUnit = useMemo(() => {
    const activeIds = new Set(activeEnrollments.map((c) => c.courseId));
    const metas = library.installedMetas
      .filter((m) => activeIds.has(m.courseId))
      .sort((a, b) => a.unitNumber - b.unitNumber);
    return (
      metas.find((m) => !library.completionByUnitId.has(m.unitId)) ??
      metas[0] ??
      null
    );
  }, [activeEnrollments, library.installedMetas, library.completionByUnitId]);

  const activeCountdowns = useMemo(
    () =>
      activeCourseInputs
        .map((c) => {
          const remaining = computeDaysRemaining(c.goalDate);
          return remaining ? { course: c, remaining } : null;
        })
        .filter(
          (
            item
          ): item is {
            course: (typeof activeCourseInputs)[number];
            remaining: { days: number; label: string };
          } => item !== null
        ),
    [activeCourseInputs]
  );

  const checkedHomework = new Set(
    library.todayActivity?.checkedHomeworkIds ?? []
  );
  const completedSessions = new Set(
    library.todayActivity?.completedSessionIndices ?? []
  );

  const activeSession =
    daySchedule.sessions[
      Math.min(activeSessionIdx, Math.max(0, daySchedule.sessions.length - 1))
    ];

  const handleToggleTimer = () => {
    if (remainingSeconds === 0) {
      setElapsedSeconds(0);
      loggedMinutesRef.current = 0;
    }
    const nextRunning = !isRunning;
    setIsRunning(nextRunning);
    setTimerAnnouncement(
      nextRunning ? "Focus timer started." : "Focus timer paused."
    );
  };

  const handleResetTimer = () => {
    setIsRunning(false);
    setElapsedSeconds(0);
    loggedMinutesRef.current = 0;
    setTimerAnnouncement("Focus timer reset.");
  };

  const handleCheckHomework = async (id: string) => {
    await toggleHomeworkCheck(id);
    notifyOfflineDbChanged();
  };

  const progressPct =
    totalSessionSeconds > 0
      ? Math.round(
          ((totalSessionSeconds - remainingSeconds) / totalSessionSeconds) * 100
        )
      : 0;

  return (
    <div className="space-y-4">
      <div className="sr-only" aria-live="polite">
        {timerAnnouncement}
      </div>

      <section aria-labelledby="today-heading" className="hig-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1
              id="today-heading"
              className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]"
            >
              Today
            </h1>
            <p className="mt-1 text-[14px] text-[var(--ink-secondary)]">
              Steady daily immersion tailored to your active goal levels.
            </p>
          </div>

          <button
            id="today-goal-dates-btn"
            type="button"
            onClick={onOpenSettings}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--bg-pill)] px-3.5 text-[13px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
          >
            <Calendar className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span className="tabular-nums">
              {activeCountdowns[0]
                ? `${activeCountdowns[0].course.displayLabel} · ${activeCountdowns[0].remaining.label}`
                : "Set goal dates"}
            </span>
          </button>
        </div>

        {activeCourseInputs.length > 0 && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {activeCourseInputs.map((course) => {
              const countdown = computeDaysRemaining(course.goalDate);
              return (
                <span
                  key={course.courseId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[13px] font-medium text-[var(--ink-primary)]"
                >
                  <span>
                    {course.displayLabel} · {TIER_META[course.tier].label}
                  </span>
                  {course.goalDate && (
                    <span className="text-[var(--ink-secondary)] tabular-nums">
                      ({countdown?.label ?? formatGoalDateHuman(course.goalDate)})
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {library.installedShards.length === 0 && (
        <section
          aria-label="Get started"
          className="hig-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="min-w-0 space-y-1">
            <h2 className="text-[17px] font-semibold text-[var(--ink-primary)]">
              Ready for your first unit
            </h2>
            <p className="text-[14px] leading-relaxed text-[var(--ink-secondary)]">
              Choose your goal level and download Unit 1 to start your first
              session offline.
            </p>
          </div>
          <motion.button
            id="today-empty-download-cta"
            type="button"
            whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
            onClick={() => onNavigateTab("courses")}
            className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-5 text-[15px] font-semibold text-white"
          >
            <span>Open Courses</span>
            <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
          </motion.button>
        </section>
      )}

      <section
        aria-labelledby="focus-timer-heading"
        className="hig-card p-4 sm:p-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2
              id="focus-timer-heading"
              className="text-[17px] font-semibold text-[var(--ink-primary)]"
            >
              Focus Session
            </h2>
            <p className="text-[13px] text-[var(--ink-secondary)] truncate">
              {activeSession?.title ?? "Focus Session 1"} ·{" "}
              {activeSession?.subtitle ?? "Guided & Hands-Free Study"}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[12px] font-medium text-[var(--ink-secondary)] tabular-nums">
            {library.todayActivity?.focusMinutes ?? 0}m logged today
          </span>
        </div>

        <div className="hig-inset p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <div
              id="focus-timer-display"
              className="text-[48px] sm:text-[54px] font-bold leading-none tracking-tight text-[var(--ink-primary)] tabular-nums"
            >
              {formatTimerClock(remainingSeconds)}
            </div>
            <div className="mt-2 h-1.5 w-48 max-w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <motion.button
              id="focus-timer-play-pause"
              type="button"
              whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
              onClick={handleToggleTimer}
              className="inline-flex min-h-[48px] min-w-[124px] items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-[15px] font-semibold text-white"
            >
              {isRunning ? (
                <>
                  <Pause className="h-4 w-4" strokeWidth={2} />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" strokeWidth={2} />
                  <span>
                    {remainingSeconds < totalSessionSeconds ? "Resume" : "Start"}
                  </span>
                </>
              )}
            </motion.button>

            <button
              id="focus-timer-reset"
              type="button"
              onClick={handleResetTimer}
              aria-label="Reset focus session timer"
              className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        </div>

        {library.installedMetas.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {nextInstalledUnit && (
              <button
                id="today-continue-unit-btn"
                type="button"
                onClick={() => onOpenUnit(nextInstalledUnit.unitId)}
                className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl bg-[var(--bg-inset)] px-4 py-2.5 text-left hover:opacity-90 transition-opacity min-w-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <BookOpen
                    className="h-4 w-4 shrink-0 text-[var(--accent)]"
                    strokeWidth={1.9}
                  />
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold truncate">
                      Continue Unit {nextInstalledUnit.unitNumber}
                    </div>
                    <div className="text-[12px] text-[var(--ink-secondary)] truncate">
                      {nextInstalledUnit.meta.title}
                    </div>
                  </div>
                </div>
                <ArrowUpRight
                  className="h-4 w-4 shrink-0 text-[var(--ink-secondary)]"
                  strokeWidth={1.8}
                />
              </button>
            )}

            <button
              id="today-due-cards-btn"
              type="button"
              onClick={() => onNavigateTab("practice")}
              className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl bg-[var(--bg-inset)] px-4 py-2.5 text-left hover:opacity-90 transition-opacity min-w-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Layers
                  className="h-4 w-4 shrink-0 text-[var(--accent)]"
                  strokeWidth={1.9}
                />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">Practice Queue</div>
                  <div className="text-[12px] text-[var(--ink-secondary)] tabular-nums">
                    {dueQueueCount === 0
                      ? "All caught up for today"
                      : `${dueQueueCount} cards ready for review`}
                  </div>
                </div>
              </div>
              <ArrowUpRight
                className="h-4 w-4 shrink-0 text-[var(--ink-secondary)]"
                strokeWidth={1.8}
              />
            </button>
          </div>
        )}
      </section>

      {activeCourseInputs.length > 0 && (
        <section
          aria-labelledby="weekly-allocation-heading"
          className="hig-card p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="weekly-allocation-heading"
              className="text-[17px] font-semibold text-[var(--ink-primary)]"
            >
              Weekly Allocation
            </h2>
            <span className="text-[13px] font-medium text-[var(--ink-secondary)] tabular-nums">
              {weeklyAllocation.allocations
                .map((a) => a.hoursLabel)
                .join(" · ")}
            </span>
          </div>

          <div
            aria-hidden="true"
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]"
          >
            {weeklyAllocation.allocations.map((alloc, idx) => (
              <div
                key={alloc.courseId}
                className={`h-full transition-all duration-200 ${
                  BAR_SEGMENT_CLASSES[idx % BAR_SEGMENT_CLASSES.length]
                }`}
                style={{ width: `${alloc.weightPercent}%` }}
              />
            ))}
          </div>

          <div
            role="tablist"
            aria-label="Day of week schedule"
            className="grid grid-cols-7 rounded-xl bg-[var(--bg-inset)] p-1"
          >
            {WEEKDAY_LABELS.map((dayLabel, idx) => {
              const selected = idx === selectedDayIndex;
              const isToday = idx === todayIndex;
              return (
                <button
                  key={dayLabel}
                  id={`weekday-tab-${dayLabel.toLowerCase()}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setSelectedDayIndex(idx)}
                  className={`relative z-10 flex min-h-[44px] flex-col items-center justify-center rounded-[9px] text-[13px] font-medium transition-colors ${
                    selected
                      ? "text-[var(--ink-primary)] font-semibold"
                      : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  }`}
                >
                  {selected && (
                    <motion.span
                      layoutId="today-weekday-pill"
                      transition={springTransition}
                      className="absolute inset-0 -z-10 rounded-[9px] bg-[var(--bg-elevated)] shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                    />
                  )}
                  <span>{dayLabel}</span>
                  {isToday && (
                    <span className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent)]" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="divide-y divide-[var(--hairline)]">
            {daySchedule.sessions.map((block) => {
              const isCurrentFocus = block.index === activeSessionIdx;
              const isDone =
                selectedDayIndex === todayIndex &&
                completedSessions.has(block.index);
              return (
                <button
                  key={block.index}
                  type="button"
                  onClick={() => setActiveSessionIdx(block.index)}
                  className="flex min-h-[54px] w-full items-center justify-between gap-3 py-3 text-left min-w-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-[var(--ink-primary)] truncate">
                        {block.title}
                      </span>
                      {isCurrentFocus && (
                        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-[var(--ink-secondary)] truncate">
                      {block.subtitle}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[13px] text-[var(--ink-secondary)] tabular-nums">
                      {block.durationMinutes}m
                    </span>
                    {isDone && (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--status-success-bg)] text-[var(--status-success)]">
                        <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="hig-hairline-t pt-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-[var(--ink-primary)]">
                Daily Reading & Practice
              </h3>
              <span className="text-[12px] text-[var(--ink-secondary)] tabular-nums">
                {prefs.dailyPracticeMinutes}m total
              </span>
            </div>

            <div className="divide-y divide-[var(--hairline)]">
              {daySchedule.homework.map((hw) => {
                const checked = checkedHomework.has(hw.id);
                const hwCourseName =
                  hw.courseId === "all"
                    ? "All Active"
                    : resolveCourseDisplayName(
                        hw.courseId,
                        library.descriptorsByCourseId.get(hw.courseId),
                        prefs.enrolledCourses[hw.courseId]?.activeVariantId
                      );

                return (
                  <button
                    key={hw.id}
                    id={`hw-check-${hw.id}`}
                    type="button"
                    onClick={() => void handleCheckHomework(hw.id)}
                    className="flex min-h-[46px] w-full items-center justify-between gap-3 py-2 text-left min-w-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
                          checked
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--bg-inset)]"
                        }`}
                      >
                        {checked && (
                          <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                        )}
                      </span>
                      <span
                        className={`text-[14px] min-w-0 break-words ${
                          checked
                            ? "line-through text-[var(--ink-secondary)]"
                            : "text-[var(--ink-primary)]"
                        }`}
                      >
                        {hw.label}
                      </span>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-secondary)]">
                      {hwCourseName}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
