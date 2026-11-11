import {
  ArrowRight,
  Calendar,
  Check,
  Download,
  Lock,
  RefreshCw,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { BRAND } from "../config/brand";
import {
  type CourseId,
  type ManifestCourseEntry,
  TIER_META,
  TIER_ORDER,
  type UnderstandingTier,
} from "../schemas/curriculum";
import { computeUnitBytesForTier } from "../services/courseSyncService";
import {
  buildInitialEnrollmentFromManifest,
  createEnrollmentFromDescriptor,
  type EnrolledCourseConfig,
  getOrderedEnrolledCourses,
  type UserPreferences,
} from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import {
  applyEqualSplitAcrossActive,
  applyTwoCoursePreset,
  computeDaysRemaining,
  computeMultiCourseWeeklyHours,
  formatBytesHuman,
  formatGoalDateHuman,
  formatPercentHuman,
  rebalanceEnrolledCourses,
  resolveCourseDisplayName,
  updateCourseWeightWithRebalance,
} from "../utils/formatters";
import { resolveTransition, SHEET_SPRING } from "../utils/motionPresets";
import { SegmentedControl } from "./ui/SegmentedControl";
import { SwitchToggle } from "./ui/SwitchToggle";

const TWO_COURSE_PRESETS = [
  { label: "92.5 / 7.5", primary: 92.5 },
  { label: "80 / 20", primary: 80 },
  { label: "50 / 50", primary: 50 },
] as const;

export function OnboardingSheet({
  prefs,
  updatePrefs,
  library,
  onOpenRepoSettings,
}: {
  prefs: UserPreferences;
  updatePrefs: (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void;
  library: OfflineLibraryHandle;
  onOpenRepoSettings: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isDownloadingStarter, setIsDownloadingStarter] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);

  const transition = resolveTransition(prefersReducedMotion, SHEET_SPRING);

  const manifestCourses = useMemo(
    () => library.manifest?.courses ?? [],
    [library.manifest]
  );

  const effectiveEnrolled: Record<CourseId, EnrolledCourseConfig> = useMemo(() => {
    if (Object.keys(prefs.enrolledCourses).length > 0) {
      return prefs.enrolledCourses;
    }
    return buildInitialEnrollmentFromManifest(manifestCourses);
  }, [prefs.enrolledCourses, manifestCourses]);

  const activeEnrollments = useMemo(
    () => getOrderedEnrolledCourses(effectiveEnrolled, "active"),
    [effectiveEnrolled]
  );

  const persistWorkingEnrollment = (
    mutator: (
      base: Record<CourseId, EnrolledCourseConfig>
    ) => Record<CourseId, EnrolledCourseConfig>
  ) => {
    updatePrefs((prev) => {
      const seed =
        Object.keys(prev.enrolledCourses).length > 0
          ? prev.enrolledCourses
          : buildInitialEnrollmentFromManifest(manifestCourses);
      const nextEnrolled = mutator(seed);
      const firstActive =
        getOrderedEnrolledCourses(nextEnrolled, "active")[0]?.courseId ?? "";
      return {
        ...prev,
        enrolledCourses: nextEnrolled,
        activeCourseTab: prev.activeCourseTab || firstActive,
      };
    });
  };

  const handleToggleCourseSelection = (entry: ManifestCourseEntry) => {
    persistWorkingEnrollment((base) => {
      const existing = base[entry.courseId];
      const activeList = Object.values(base).filter((c) => c.status === "active");

      if (existing && existing.status === "active") {
        if (activeList.length <= 1) {
          return base;
        }
        const without = { ...base };
        delete without[entry.courseId];
        return rebalanceEnrolledCourses(without);
      }

      const added: Record<CourseId, EnrolledCourseConfig> = {
        ...base,
        [entry.courseId]: createEnrollmentFromDescriptor(entry.descriptor, {
          tier: activeList.length === 0 ? "conversational" : "essential",
          weightPercent:
            activeList.length === 0
              ? 100
              : Math.round(100 / (activeList.length + 1)),
          status: "active",
        }),
      };
      return rebalanceEnrolledCourses(added);
    });
  };

  const handleSetCourseTier = (courseId: CourseId, tier: UnderstandingTier) => {
    persistWorkingEnrollment((base) => {
      const target = base[courseId];
      if (!target) return base;
      return {
        ...base,
        [courseId]: { ...target, tier },
      };
    });
  };

  const handleSetCourseVariant = (courseId: CourseId, variantId: string) => {
    persistWorkingEnrollment((base) => {
      const target = base[courseId];
      if (!target) return base;
      return {
        ...base,
        [courseId]: { ...target, activeVariantId: variantId },
      };
    });
  };

  const handleSetGoalDate = (courseId: CourseId, goalDate: string) => {
    persistWorkingEnrollment((base) => {
      const target = base[courseId];
      if (!target) return base;
      return {
        ...base,
        [courseId]: { ...target, goalDate },
      };
    });
  };

  const weeklyAllocation = useMemo(
    () =>
      computeMultiCourseWeeklyHours(
        prefs.focusSessionsPerDay,
        prefs.focusSessionMinutes,
        activeEnrollments.map((e) => {
          const desc = library.descriptorsByCourseId.get(e.courseId);
          return {
            courseId: e.courseId,
            name: resolveCourseDisplayName(e.courseId, desc, e.activeVariantId),
            weightPercent: e.weightPercent,
          };
        })
      ),
    [
      prefs.focusSessionsPerDay,
      prefs.focusSessionMinutes,
      activeEnrollments,
      library.descriptorsByCourseId,
    ]
  );

  const starterSummary = useMemo(() => {
    const items = activeEnrollments.map((enrollment) => {
      const courseEntry = library.manifestCourseMap.get(enrollment.courseId);
      const descriptor = library.descriptorsByCourseId.get(enrollment.courseId);
      const unit1 = courseEntry?.units[0] ?? null;
      const bytes = unit1
        ? computeUnitBytesForTier(unit1, enrollment.tier).deltaBytesToFetch
        : 24_000;
      return {
        enrollment,
        descriptor,
        unit1,
        bytes,
        displayName: resolveCourseDisplayName(
          enrollment.courseId,
          descriptor,
          enrollment.activeVariantId
        ),
      };
    });
    const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
    return { items, totalBytes };
  }, [
    activeEnrollments,
    library.manifestCourseMap,
    library.descriptorsByCourseId,
  ]);

  const completeOnboardingState = () => {
    updatePrefs((prev) => {
      const finalEnrolled =
        Object.keys(prev.enrolledCourses).length > 0
          ? rebalanceEnrolledCourses(prev.enrolledCourses)
          : rebalanceEnrolledCourses(
              buildInitialEnrollmentFromManifest(manifestCourses)
            );
      const firstActive =
        getOrderedEnrolledCourses(finalEnrolled, "active")[0]?.courseId ?? "";
      return {
        ...prev,
        enrolledCourses: finalEnrolled,
        activeCourseTab: prev.activeCourseTab || firstActive,
        onboardingCompleted: true,
      };
    });
  };

  const handleDownloadStarters = async () => {
    setStarterError(null);
    setIsDownloadingStarter(true);
    try {
      if (!library.manifest) {
        await library.refreshCatalog();
      }

      const targets = starterSummary.items.filter(
        (item) => item.enrollment.weightPercent > 0 && item.unit1
      );
      if (targets.length === 0) {
        throw new Error(
          "Starter units could not be reached yet. Check your connection or repository settings."
        );
      }

      for (const item of targets) {
        if (item.unit1) {
          await library.downloadUnit(
            item.unit1,
            item.enrollment.courseId,
            item.enrollment.tier
          );
        }
      }

      completeOnboardingState();
    } catch (err) {
      setStarterError(
        err instanceof Error
          ? err.message
          : "Download interrupted. Check your connection and try again."
      );
    } finally {
      setIsDownloadingStarter(false);
    }
  };

  const activeProgressBytes = Object.values(library.downloadProgress).reduce(
    (sum, p) => sum + p.loadedBytes,
    0
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4 backdrop-blur-xs"
    >
      <motion.div
        initial={
          prefersReducedMotion
            ? { opacity: 1 }
            : { opacity: 0, y: 36, scale: 0.98 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={transition}
        className="w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-[24px] sm:rounded-[24px] bg-[var(--bg-canvas)] px-5 pt-5 pb-8 pb-safe shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((dot) => (
              <span
                key={dot}
                className={`h-2 rounded-full transition-all duration-200 ${
                  dot === step
                    ? "w-6 bg-[var(--accent)]"
                    : dot < step
                      ? "w-2 bg-[var(--accent)] opacity-50"
                      : "w-2 bg-black/15 dark:bg-white/20"
                }`}
              />
            ))}
          </div>
          <span className="text-[13px] font-medium text-[var(--ink-secondary)] tabular-nums">
            Step {step} of 3
          </span>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="onboard-step-1"
              initial={
                prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 14 }
              }
              animate={{ opacity: 1, x: 0 }}
              exit={
                prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }
              }
              transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
              className="space-y-4"
            >
              <div>
                <h1
                  id="onboarding-title"
                  className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]"
                >
                  Welcome to {BRAND.appName}
                </h1>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--ink-secondary)]">
                  Select your languages and target depth. {BRAND.appName} pulls
                  only the lesson tiers that match your goals.
                </p>
              </div>

              {library.isSyncingCatalog && manifestCourses.length === 0 && (
                <div className="hig-card p-5 space-y-3 animate-pulse">
                  <div className="h-5 w-44 rounded-lg bg-[var(--bg-inset)]" />
                  <div className="h-14 w-full rounded-xl bg-[var(--bg-inset)]" />
                  <div className="h-14 w-full rounded-xl bg-[var(--bg-inset)]" />
                </div>
              )}

              {library.catalogError && manifestCourses.length === 0 && (
                <div className="hig-card p-4 space-y-3">
                  <p className="text-[13px] text-[var(--status-danger)] break-words">
                    {library.catalogError}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void library.refreshCatalog()}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
                    >
                      <RefreshCw className="h-4 w-4" strokeWidth={2} />
                      <span>Retry</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenRepoSettings}
                      className="inline-flex min-h-[42px] items-center rounded-full bg-[var(--bg-pill)] px-4 text-[13px] font-medium text-[var(--ink-primary)]"
                    >
                      Repository Settings
                    </button>
                  </div>
                </div>
              )}

              {manifestCourses.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {manifestCourses.map((entry) => {
                    const selected =
                      effectiveEnrolled[entry.courseId]?.status === "active";
                    return (
                      <button
                        key={entry.courseId}
                        id={`onboard-toggle-course-${entry.courseId}`}
                        type="button"
                        onClick={() => handleToggleCourseSelection(entry)}
                        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                          selected
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--bg-pill)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                        }`}
                      >
                        {selected && (
                          <Check className="h-3.5 w-3.5" strokeWidth={2.3} />
                        )}
                        <span>{entry.descriptor.name}</span>
                        <span
                          dir={entry.descriptor.textDirection}
                          className={
                            selected
                              ? "text-white/80 font-normal"
                              : "text-[var(--ink-secondary)] font-normal"
                          }
                        >
                          {entry.descriptor.nativeName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="space-y-3">
                {activeEnrollments.map((enrollment) => {
                  const descriptor = library.descriptorsByCourseId.get(
                    enrollment.courseId
                  );
                  if (!descriptor) return null;

                  const activeTier = enrollment.tier;
                  const tierDescription =
                    descriptor.tierDescriptions?.[activeTier] ??
                    TIER_META[activeTier].defaultDescription;
                  const variants = descriptor.variants ?? [];

                  return (
                    <div
                      key={enrollment.courseId}
                      className="hig-card p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <h2 className="text-[16px] font-semibold truncate">
                            {descriptor.name} Goal
                          </h2>
                          <span
                            dir={descriptor.textDirection}
                            className="text-[13px] text-[var(--ink-secondary)] shrink-0"
                          >
                            {descriptor.nativeName}
                          </span>
                        </div>
                        <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink-secondary)]">
                          {descriptor.proficiencyFramework.name}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {TIER_ORDER.map((tier) => {
                          const active = activeTier === tier;
                          return (
                            <button
                              key={tier}
                              id={`onboard-${enrollment.courseId}-tier-${tier}`}
                              type="button"
                              onClick={() =>
                                handleSetCourseTier(enrollment.courseId, tier)
                              }
                              className={`min-h-[48px] rounded-xl px-3 py-2.5 text-left transition-colors ${
                                active
                                  ? "bg-[var(--accent)] text-white"
                                  : "bg-[var(--bg-inset)] text-[var(--ink-primary)] hover:opacity-90"
                              }`}
                            >
                              <div className="text-[14px] font-semibold">
                                {TIER_META[tier].label}
                              </div>
                              <div
                                className={`text-[12px] ${
                                  active
                                    ? "text-white/85"
                                    : "text-[var(--ink-secondary)]"
                                }`}
                              >
                                Tier {TIER_META[tier].number}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <p className="text-[13px] leading-relaxed text-[var(--ink-secondary)]">
                        {tierDescription}
                      </p>

                      {variants.length > 1 && (
                        <div className="hig-hairline-t pt-3 space-y-2">
                          <div className="text-[13px] font-medium text-[var(--ink-primary)]">
                            Regional Focus & Voice
                          </div>
                          <SegmentedControl<string>
                            id={`onboard-variant-${enrollment.courseId}`}
                            ariaLabel={`${descriptor.name} regional focus`}
                            compact
                            value={
                              enrollment.activeVariantId ?? variants[0].id
                            }
                            onChange={(variantId) =>
                              handleSetCourseVariant(
                                enrollment.courseId,
                                variantId
                              )
                            }
                            options={variants.map((v) => ({
                              value: v.id,
                              label: v.label,
                            }))}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <motion.button
                id="onboard-next-1"
                type="button"
                disabled={activeEnrollments.length === 0}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                onClick={() => {
                  persistWorkingEnrollment((base) =>
                    rebalanceEnrolledCourses(base)
                  );
                  setStep(2);
                }}
                className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-white disabled:opacity-50"
              >
                <span>Continue to Study Rhythm</span>
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </motion.button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="onboard-step-2"
              initial={
                prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 14 }
              }
              animate={{ opacity: 1, x: 0 }}
              exit={
                prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }
              }
              transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
              className="space-y-4"
            >
              <div>
                <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
                  Set Your Weekly Split
                </h1>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--ink-secondary)]">
                  Allocate focus blocks, flashcard reviews, and Phrase Lock
                  prompts across your active courses.
                </p>
              </div>

              <div className="hig-card p-4 space-y-4">
                {activeEnrollments.length === 1 ? (
                  <div className="flex items-center justify-between text-[15px] font-semibold tabular-nums">
                    <span>
                      100%{" "}
                      {weeklyAllocation.allocations[0]?.name ??
                        activeEnrollments[0].courseId}
                    </span>
                    <span className="text-[13px] font-medium text-[var(--ink-secondary)]">
                      {weeklyAllocation.allocations[0]?.hoursLabel}
                    </span>
                  </div>
                ) : activeEnrollments.length === 2 ? (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold tabular-nums">
                        {formatPercentHuman(activeEnrollments[0].weightPercent)}{" "}
                        {weeklyAllocation.allocations[0]?.name}
                      </span>
                      <span className="text-[15px] font-semibold text-[var(--ink-secondary)] tabular-nums">
                        {formatPercentHuman(activeEnrollments[1].weightPercent)}{" "}
                        {weeklyAllocation.allocations[1]?.name}
                      </span>
                    </div>

                    <input
                      id="onboard-split-slider"
                      type="range"
                      min={0}
                      max={100}
                      step={2.5}
                      value={activeEnrollments[0].weightPercent}
                      aria-label={`Weekly ${weeklyAllocation.allocations[0]?.name ?? ""} percentage`}
                      onChange={(e) =>
                        persistWorkingEnrollment((base) =>
                          updateCourseWeightWithRebalance(
                            base,
                            activeEnrollments[0].courseId,
                            Number(e.target.value),
                            true
                          )
                        )
                      }
                      className="w-full accent-[var(--accent)] h-2 cursor-pointer"
                    />

                    <div className="flex flex-wrap gap-2">
                      {TWO_COURSE_PRESETS.map((preset) => {
                        const selected =
                          Math.abs(
                            activeEnrollments[0].weightPercent - preset.primary
                          ) < 0.25;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              persistWorkingEnrollment((base) =>
                                applyTwoCoursePreset(
                                  base,
                                  activeEnrollments[0].courseId,
                                  preset.primary
                                )
                              )
                            }
                            className={`min-h-[38px] rounded-full px-3.5 text-[13px] font-medium tabular-nums transition-colors ${
                              selected
                                ? "bg-[var(--accent)] text-white"
                                : "bg-[var(--bg-pill)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink-secondary)]">
                        <Lock className="h-3.5 w-3.5" strokeWidth={1.8} />
                        <span>Rebalance to 100%</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            persistWorkingEnrollment((base) =>
                              applyEqualSplitAcrossActive(base)
                            )
                          }
                          className="min-h-[34px] rounded-full bg-[var(--bg-pill)] px-3 text-[12px] font-medium text-[var(--ink-primary)]"
                        >
                          Equal Split
                        </button>
                        <SwitchToggle
                          id="onboard-rebalance-lock"
                          checked={prefs.rebalanceLocked}
                          onChange={(locked) => {
                            updatePrefs((prev) => ({
                              ...prev,
                              rebalanceLocked: locked,
                              enrolledCourses: locked
                                ? rebalanceEnrolledCourses(prev.enrolledCourses)
                                : prev.enrolledCourses,
                            }));
                          }}
                          ariaLabel="Keep course weights balanced to 100 percent"
                        />
                      </div>
                    </div>

                    {activeEnrollments.map((enrollment, idx) => {
                      const alloc = weeklyAllocation.allocations[idx];
                      return (
                        <div key={enrollment.courseId} className="space-y-1">
                          <div className="flex items-center justify-between text-[13px] font-medium tabular-nums">
                            <span>{alloc?.name ?? enrollment.courseId}</span>
                            <span>
                              {formatPercentHuman(enrollment.weightPercent)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={2.5}
                            value={enrollment.weightPercent}
                            aria-label={`${alloc?.name ?? enrollment.courseId} study percentage`}
                            onChange={(e) =>
                              persistWorkingEnrollment((base) =>
                                updateCourseWeightWithRebalance(
                                  base,
                                  enrollment.courseId,
                                  Number(e.target.value),
                                  prefs.rebalanceLocked
                                )
                              )
                            }
                            className="w-full accent-[var(--accent)]"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="hig-hairline-t pt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--ink-secondary)] tabular-nums">
                  <span>Weekly Focus Allocation</span>
                  <span className="font-semibold text-[var(--ink-primary)]">
                    {weeklyAllocation.allocations
                      .map((a) => a.hoursLabel)
                      .join(" · ")}
                  </span>
                </div>
              </div>

              <div className="hig-card divide-y divide-[var(--hairline)] px-4">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-[14px] font-medium">
                      Daily Focus Sessions
                    </div>
                    <div className="text-[12px] text-[var(--ink-secondary)] tabular-nums">
                      {prefs.focusSessionsPerDay} × {prefs.focusSessionMinutes}m
                      blocks
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() =>
                          updatePrefs({ focusSessionsPerDay: count })
                        }
                        className={`min-h-[40px] min-w-[40px] rounded-xl text-[14px] font-semibold tabular-nums ${
                          prefs.focusSessionsPerDay === count
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--bg-inset)] text-[var(--ink-primary)]"
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-[14px] font-medium">
                      Daily Reading & Practice
                    </div>
                    <div className="text-[12px] text-[var(--ink-secondary)]">
                      Flashcards, graded stories, and reference drills
                    </div>
                  </div>
                  <select
                    id="onboard-practice-mins"
                    aria-label="Daily reading and practice minutes"
                    value={prefs.dailyPracticeMinutes}
                    onChange={(e) =>
                      updatePrefs({
                        dailyPracticeMinutes: Number(e.target.value),
                      })
                    }
                    className="min-h-[40px] rounded-xl bg-[var(--bg-inset)] px-3 text-[14px] font-medium tabular-nums"
                  >
                    <option value={25}>25m / day</option>
                    <option value={50}>50m / day</option>
                    <option value={75}>75m / day</option>
                  </select>
                </div>

                <div className="py-3 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink-secondary)]">
                    <Calendar className="h-4 w-4" strokeWidth={1.8} />
                    <span>Optional Departure or Goal Dates</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {activeEnrollments.map((enrollment) => {
                      const desc = library.descriptorsByCourseId.get(
                        enrollment.courseId
                      );
                      const label = resolveCourseDisplayName(
                        enrollment.courseId,
                        desc,
                        enrollment.activeVariantId
                      );
                      const countdown = computeDaysRemaining(
                        enrollment.goalDate
                      );
                      return (
                        <label
                          key={enrollment.courseId}
                          className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2"
                        >
                          <span className="block text-[12px] text-[var(--ink-secondary)] truncate">
                            {label}
                            {enrollment.goalDate
                              ? ` · ${
                                  countdown?.label ??
                                  formatGoalDateHuman(enrollment.goalDate)
                                }`
                              : ""}
                          </span>
                          <input
                            type="date"
                            value={enrollment.goalDate}
                            onChange={(e) =>
                              handleSetGoalDate(
                                enrollment.courseId,
                                e.target.value
                              )
                            }
                            className="mt-0.5 w-full bg-transparent text-[14px] font-medium"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="min-h-[50px] rounded-full bg-[var(--bg-pill)] px-5 text-[15px] font-medium text-[var(--ink-primary)]"
                >
                  Back
                </button>
                <motion.button
                  id="onboard-next-2"
                  type="button"
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                  onClick={() => setStep(3)}
                  className="flex min-h-[50px] flex-1 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-white"
                >
                  <span>Review Starter Units</span>
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </motion.button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="onboard-step-3"
              initial={
                prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 14 }
              }
              animate={{ opacity: 1, x: 0 }}
              exit={
                prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }
              }
              transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
              className="space-y-4"
            >
              <div>
                <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
                  Download Starter Units
                </h1>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--ink-secondary)]">
                  Fetch Unit 1 for offline Guided lessons, Hands-Free audio
                  loops, flashcards, and graded stories.
                </p>
              </div>

              <div className="hig-card divide-y divide-[var(--hairline)] px-4">
                {starterSummary.items.map((item) => {
                  const tierNum = TIER_META[item.enrollment.tier].number;
                  return (
                    <div
                      key={item.enrollment.courseId}
                      className="flex items-center justify-between py-3.5 gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold truncate">
                          {item.unit1?.title ?? `${item.displayName} · Unit 1`}
                        </div>
                        <div className="text-[13px] text-[var(--ink-secondary)]">
                          {item.displayName} ·{" "}
                          {TIER_META[item.enrollment.tier].label} (
                          {tierNum === 1
                            ? "Tier 1 only"
                            : `Tiers 1–${tierNum}`}
                          )
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[13px] font-medium text-[var(--ink-secondary)] tabular-nums">
                        {formatBytesHuman(item.bytes)}
                      </span>
                    </div>
                  );
                })}

                <div className="flex items-center justify-between py-3 text-[13px] text-[var(--ink-secondary)]">
                  <span className="flex items-center gap-1.5">
                    <Sparkles
                      className="h-4 w-4 text-[var(--accent)]"
                      strokeWidth={1.8}
                    />
                    <span>Cached locally for instant offline study</span>
                  </span>
                  <span className="font-semibold text-[var(--ink-primary)] tabular-nums">
                    Total {formatBytesHuman(starterSummary.totalBytes)}
                  </span>
                </div>
              </div>

              <div aria-live="polite">
                {isDownloadingStarter && (
                  <div className="hig-card p-4 space-y-2">
                    <div className="flex items-center justify-between text-[13px] font-medium tabular-nums">
                      <span>Downloading starter shards...</span>
                      <span>
                        {formatBytesHuman(activeProgressBytes)} /{" "}
                        {formatBytesHuman(starterSummary.totalBytes)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-all duration-150"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              12,
                              Math.round(
                                (activeProgressBytes /
                                  Math.max(1, starterSummary.totalBytes)) *
                                  100
                              )
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {library.isOffline && !starterError && (
                  <div className="flex items-center gap-2.5 rounded-2xl bg-[var(--status-warn-bg)] px-4 py-3 text-[13px] text-[var(--status-warn)]">
                    <WifiOff className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                    <span>
                      You appear to be offline. Connect briefly to download Unit
                      1, or explore the app shell first.
                    </span>
                  </div>
                )}

                {starterError && (
                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--status-danger-bg)] px-4 py-3 text-[13px] text-[var(--status-danger)]">
                    <span className="min-w-0 break-words">{starterError}</span>
                    <button
                      type="button"
                      onClick={() => void handleDownloadStarters()}
                      className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full bg-white/80 dark:bg-black/40 px-3 font-semibold"
                    >
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                      <span>Retry</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2.5">
                <motion.button
                  id="onboard-download-starters"
                  type="button"
                  disabled={isDownloadingStarter}
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                  onClick={() => void handleDownloadStarters()}
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-white disabled:opacity-60"
                >
                  {isDownloadingStarter ? (
                    <>
                      <RefreshCw
                        className="h-4 w-4 animate-spin"
                        strokeWidth={2}
                      />
                      <span>Installing Starter Units...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" strokeWidth={2} />
                      <span>Download Starter Units</span>
                    </>
                  )}
                </motion.button>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="min-h-[44px] px-3 text-[14px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  >
                    Back
                  </button>
                  <button
                    id="onboard-skip-to-catalog"
                    type="button"
                    onClick={completeOnboardingState}
                    className="inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[14px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  >
                    <Check className="h-4 w-4" strokeWidth={1.8} />
                    <span>Explore catalog first</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
