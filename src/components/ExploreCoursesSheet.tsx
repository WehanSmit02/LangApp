import {
  Check,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  type CourseId,
  type ManifestCourseEntry,
  TIER_META,
} from "../schemas/curriculum";
import {
  createEnrollmentFromDescriptor,
  type EnrolledCourseConfig,
  type UserPreferences,
} from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import {
  formatPercentHuman,
  rebalanceEnrolledCourses,
} from "../utils/formatters";
import { resolveTransition, SHEET_SPRING } from "../utils/motionPresets";

export function ExploreCoursesSheet({
  prefs,
  updatePrefs,
  library,
  onClose,
  onSelectCourseTab,
}: {
  prefs: UserPreferences;
  updatePrefs: (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void;
  library: OfflineLibraryHandle;
  onClose: () => void;
  onSelectCourseTab?: (courseId: CourseId) => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const sheetTransition = resolveTransition(prefersReducedMotion, SHEET_SPRING);

  const courses = library.manifest?.courses ?? [];
  const activeCount = Object.values(prefs.enrolledCourses).filter(
    (c) => c.status === "active"
  ).length;

  const handleEnrollCourse = (entry: ManifestCourseEntry) => {
    updatePrefs((prev) => {
      const currentActive = Object.values(prev.enrolledCourses).filter(
        (c) => c.status === "active"
      );
      const suggestedShare =
        currentActive.length === 0
          ? 100
          : Math.max(10, Math.round(100 / (currentActive.length + 1)));

      const nextMap: Record<CourseId, EnrolledCourseConfig> = {
        ...prev.enrolledCourses,
        [entry.courseId]: createEnrollmentFromDescriptor(entry.descriptor, {
          tier: "essential",
          weightPercent: suggestedShare,
          status: "active",
        }),
      };

      return {
        ...prev,
        enrolledCourses: rebalanceEnrolledCourses(nextMap),
        activeCourseTab: entry.courseId,
      };
    });

    void library.ensureCourseAssets(entry.courseId);
    onSelectCourseTab?.(entry.courseId);
  };

  const handleTogglePause = (courseId: CourseId) => {
    updatePrefs((prev) => {
      const target = prev.enrolledCourses[courseId];
      if (!target) return prev;

      const currentlyActive = Object.values(prev.enrolledCourses).filter(
        (c) => c.status === "active"
      );
      if (target.status === "active" && currentlyActive.length <= 1) {
        return prev;
      }

      const nextStatus = target.status === "active" ? "paused" : "active";
      const nextWeight =
        nextStatus === "active"
          ? Math.max(10, target.weightPercent || 15)
          : target.weightPercent;

      const nextMap: Record<CourseId, EnrolledCourseConfig> = {
        ...prev.enrolledCourses,
        [courseId]: {
          ...target,
          status: nextStatus,
          weightPercent: nextWeight,
        },
      };

      const rebalanced = rebalanceEnrolledCourses(nextMap);
      const fallbackActive =
        Object.values(rebalanced).find((c) => c.status === "active")
          ?.courseId ?? prev.activeCourseTab;

      return {
        ...prev,
        enrolledCourses: rebalanced,
        activeCourseTab:
          nextStatus === "active" ? courseId : fallbackActive,
      };
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="explore-courses-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 backdrop-blur-xs"
    >
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.35 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 110) {
            onClose();
          }
        }}
        initial={
          prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: "100%" }
        }
        animate={{ opacity: 1, y: 0 }}
        exit={
          prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: "100%" }
        }
        transition={sheetTransition}
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-t-[26px] sm:rounded-[26px] bg-[var(--bg-canvas)] px-5 pt-3 pb-8 pb-safe shadow-2xl space-y-4"
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20 sm:hidden" />

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="explore-courses-title"
              className="text-[20px] font-bold text-[var(--ink-primary)]"
            >
              Explore Courses
            </h2>
            <p className="text-[13px] text-[var(--ink-secondary)]">
              Discovered live from your curriculum repository. Pause any course without losing offline progress.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              id="explore-refresh-btn"
              type="button"
              onClick={() => void library.refreshCatalog()}
              aria-label="Refresh repository course list"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            >
              <RefreshCw
                className={`h-4 w-4 ${library.isSyncingCatalog ? "animate-spin" : ""}`}
                strokeWidth={1.9}
              />
            </button>
            <button
              id="explore-close-btn"
              type="button"
              onClick={onClose}
              aria-label="Close Explore Courses"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            >
              <X className="h-5 w-5" strokeWidth={1.9} />
            </button>
          </div>
        </div>

        {courses.length === 0 ? (
          <div className="hig-card p-6 text-center space-y-3">
            <p className="text-[14px] text-[var(--ink-secondary)]">
              {library.isSyncingCatalog
                ? "Checking repository for available language courses..."
                : library.catalogError ??
                  "No courses found in manifest.json yet."}
            </p>
            <button
              type="button"
              onClick={() => void library.refreshCatalog()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[14px] font-semibold text-white"
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2} />
              <span>Retry Sync</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {courses.map((entry) => {
              const enrolled = prefs.enrolledCourses[entry.courseId];
              const isActive = enrolled?.status === "active";
              const isPaused = enrolled?.status === "paused";
              const { descriptor } = entry;

              const capabilityBadges: string[] = [
                descriptor.proficiencyFramework.name,
                `${entry.unitCount} of ${entry.totalPlannedUnits} units ready`,
              ];
              if (descriptor.readingFeatures.rubyAnnotations) {
                capabilityBadges.push(
                  descriptor.readingFeatures.rubyAnnotations.label
                );
              }
              if (descriptor.readingFeatures.compoundSplitter) {
                capabilityBadges.push(
                  descriptor.readingFeatures.compoundSplitter.label
                );
              }
              if (descriptor.hasScriptGrids) {
                capabilityBadges.push("Soundboard");
              }

              return (
                <article
                  key={entry.courseId}
                  className="hig-card p-4 space-y-3 min-w-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-[17px] font-semibold text-[var(--ink-primary)]">
                          {descriptor.name}
                        </h3>
                        <span
                          dir={descriptor.textDirection}
                          className="text-[14px] font-medium text-[var(--ink-secondary)]"
                        >
                          {descriptor.nativeName}
                        </span>
                        {isActive && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-success-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--status-success)] tabular-nums">
                            <Check className="h-3 w-3" strokeWidth={2.2} />
                            <span>
                              Active ·{" "}
                              {formatPercentHuman(enrolled.weightPercent)}
                            </span>
                          </span>
                        )}
                        {isPaused && (
                          <span className="rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-secondary)]">
                            Paused · {TIER_META[enrolled.tier].shortLabel}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-secondary)]">
                        {descriptor.summary}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {capabilityBadges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-secondary)] tabular-nums"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>

                  <div className="hig-hairline-t pt-3 flex flex-wrap items-center justify-between gap-2">
                    {!enrolled ? (
                      <motion.button
                        id={`enroll-course-${entry.courseId}`}
                        type="button"
                        whileTap={
                          prefersReducedMotion ? undefined : { scale: 0.97 }
                        }
                        onClick={() => handleEnrollCourse(entry)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
                      >
                        <Plus className="h-4 w-4" strokeWidth={2.1} />
                        <span>Add {descriptor.name}</span>
                      </motion.button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {isActive ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectCourseTab?.(entry.courseId);
                                onClose();
                              }}
                              className="inline-flex min-h-[42px] items-center rounded-full bg-[var(--accent-soft)] px-4 text-[13px] font-semibold text-[var(--accent)]"
                            >
                              Open Course
                            </button>
                            {activeCount > 1 && (
                              <button
                                id={`pause-course-${entry.courseId}`}
                                type="button"
                                onClick={() => handleTogglePause(entry.courseId)}
                                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full bg-[var(--bg-inset)] px-3.5 text-[13px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                              >
                                <PauseCircle
                                  className="h-4 w-4"
                                  strokeWidth={1.8}
                                />
                                <span>Pause</span>
                              </button>
                            )}
                          </>
                        ) : (
                          <motion.button
                            id={`resume-course-${entry.courseId}`}
                            type="button"
                            whileTap={
                              prefersReducedMotion ? undefined : { scale: 0.97 }
                            }
                            onClick={() => handleTogglePause(entry.courseId)}
                            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
                          >
                            <PlayCircle className="h-4 w-4" strokeWidth={2} />
                            <span>Resume Course</span>
                          </motion.button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
