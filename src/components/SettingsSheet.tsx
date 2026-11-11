import {
  Check,
  Copy,
  GitBranch,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { BRAND } from "../config/brand";
import {
  type CurriculumRepoConfig,
  DEFAULT_REPO_CONFIG,
  describeActiveEndpoint,
} from "../services/githubRepoSync";
import {
  getOrderedEnrolledCourses,
  type ThemePreference,
  type UserPreferences,
} from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import {
  applyEqualSplitAcrossActive,
  applyTwoCoursePreset,
  formatBytesHuman,
  formatPercentHuman,
  normalizeCourseWeightsMap,
  rebalanceEnrolledCourses,
  resolveCourseDisplayName,
  updateCourseWeightWithRebalance,
} from "../utils/formatters";
import { resolveTransition, SHEET_SPRING } from "../utils/motionPresets";
import { SegmentedControl } from "./ui/SegmentedControl";
import { SwitchToggle } from "./ui/SwitchToggle";

const SHORTCUT_APP_PRESETS = [
  { label: "Instagram", scheme: "instagram://" },
  { label: "YouTube", scheme: "youtube://" },
  { label: "TikTok", scheme: "snssdk1233://" },
  { label: "X", scheme: "twitter://" },
  { label: "Reddit", scheme: "reddit://" },
] as const;

const TWO_COURSE_PRESETS = [
  { label: "92.5 / 7.5", primary: 92.5 },
  { label: "80 / 20", primary: 80 },
  { label: "50 / 50", primary: 50 },
] as const;

export function SettingsSheet({
  prefs,
  updatePrefs,
  library,
  onOpenExploreCourses,
  onClose,
}: {
  prefs: UserPreferences;
  updatePrefs: (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void;
  library: OfflineLibraryHandle;
  onOpenExploreCourses: () => void;
  onClose: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const sheetTransition = resolveTransition(prefersReducedMotion, SHEET_SPRING);

  const [shortcutPresetIdx, setShortcutPresetIdx] = useState<number>(0);
  const [copiedShortcut, setCopiedShortcut] = useState<boolean>(false);
  const [repoDraft, setRepoDraft] = useState<CurriculumRepoConfig>(
    prefs.repoConfig
  );
  const [savedRepoFeedback, setSavedRepoFeedback] = useState<boolean>(false);

  const activeEnrollments = useMemo(
    () => getOrderedEnrolledCourses(prefs.enrolledCourses, "active"),
    [prefs.enrolledCourses]
  );

  const normalizedWeights = useMemo(
    () => normalizeCourseWeightsMap(prefs.enrolledCourses),
    [prefs.enrolledCourses]
  );

  const chosenShortcut = SHORTCUT_APP_PRESETS[shortcutPresetIdx];

  const buildShortcutUrl = () => {
    const origin =
      typeof window !== "undefined"
        ? `${window.location.origin}/`
        : "https://lang.example.com/";
    const url = new URL(origin);
    url.searchParams.set("lock", "1");
    url.searchParams.set("app", chosenShortcut.label);
    url.searchParams.set("scheme", chosenShortcut.scheme);
    return url.toString();
  };

  const handleCopyShortcutUrl = async () => {
    const url = buildShortcutUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopiedShortcut(true);
      window.setTimeout(() => setCopiedShortcut(false), 2200);
    } catch {
      // Clipboard blocked on insecure contexts
    }
  };

  const handleSaveRepoConfig = () => {
    const cleaned: CurriculumRepoConfig = {
      mode: repoDraft.mode,
      owner: repoDraft.owner.trim() || BRAND.curriculumRepo.owner,
      repo: repoDraft.repo.trim() || BRAND.curriculumRepo.repo,
      branch: repoDraft.branch.trim() || BRAND.curriculumRepo.branch,
      privateToken: repoDraft.privateToken.trim(),
      useLocalWorkspace: Boolean(repoDraft.useLocalWorkspace),
    };
    setRepoDraft(cleaned);
    updatePrefs({ repoConfig: cleaned });
    setSavedRepoFeedback(true);
    window.setTimeout(() => setSavedRepoFeedback(false), 2000);
    void library.refreshCatalog();
  };

  const handleResetRepoDefaults = () => {
    setRepoDraft(DEFAULT_REPO_CONFIG);
    updatePrefs({ repoConfig: DEFAULT_REPO_CONFIG });
    void library.refreshCatalog();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-sheet-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 backdrop-blur-xs"
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
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-t-[26px] sm:rounded-[26px] bg-[var(--bg-canvas)] px-5 pt-3 pb-8 pb-safe shadow-2xl space-y-5"
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20 sm:hidden" />

        <div className="flex items-center justify-between">
          <h2
            id="settings-sheet-title"
            className="text-[20px] font-bold text-[var(--ink-primary)]"
          >
            Settings
          </h2>
          <button
            id="settings-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-5 w-5" strokeWidth={1.9} />
          </button>
        </div>

        <section className="hig-card p-4 space-y-3">
          <h3 className="text-[15px] font-semibold">Appearance</h3>
          <SegmentedControl<ThemePreference>
            id="settings-theme-control"
            ariaLabel="Appearance theme"
            compact
            value={prefs.theme}
            onChange={(next) => updatePrefs({ theme: next })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </section>

        <section className="hig-card divide-y divide-[var(--hairline)] px-4">
          <div className="py-3.5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold">
                  Enrolled Courses & Study Split
                </div>
                <div className="text-[12px] text-[var(--ink-secondary)]">
                  Adjust active language weights across Focus Sessions and Practice
                </div>
              </div>
              <button
                id="settings-manage-languages-btn"
                type="button"
                onClick={onOpenExploreCourses}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--bg-inset)] px-3.5 text-[13px] font-semibold text-[var(--accent)]"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.1} />
                <span>Languages</span>
              </button>
            </div>

            {activeEnrollments.length === 0 && (
              <button
                type="button"
                onClick={onOpenExploreCourses}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[var(--bg-inset)] px-4 text-[13px] font-medium text-[var(--ink-secondary)]"
              >
                Add or resume a language course to schedule study sessions
              </button>
            )}

            {activeEnrollments.length === 1 && (
              <div className="flex items-center justify-between rounded-xl bg-[var(--bg-inset)] px-3.5 py-2.5 text-[14px]">
                <span className="font-medium">
                  {resolveCourseDisplayName(
                    activeEnrollments[0].courseId,
                    library.descriptorsByCourseId.get(
                      activeEnrollments[0].courseId
                    ),
                    activeEnrollments[0].activeVariantId
                  )}
                </span>
                <span className="font-semibold text-[var(--accent)] tabular-nums">
                  100% Focus Allocation
                </span>
              </div>
            )}

            {activeEnrollments.length === 2 && (() => {
              const primary = activeEnrollments[0];
              const secondary = activeEnrollments[1];
              const primaryName = resolveCourseDisplayName(
                primary.courseId,
                library.descriptorsByCourseId.get(primary.courseId),
                primary.activeVariantId
              );
              const secondaryName = resolveCourseDisplayName(
                secondary.courseId,
                library.descriptorsByCourseId.get(secondary.courseId),
                secondary.activeVariantId
              );
              const primaryPct =
                normalizedWeights[primary.courseId] ?? primary.weightPercent;
              const secondaryPct =
                normalizedWeights[secondary.courseId] ?? secondary.weightPercent;

              return (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[13px] font-medium tabular-nums">
                    <span>
                      {primaryName} {formatPercentHuman(primaryPct)}
                    </span>
                    <span>
                      {secondaryName} {formatPercentHuman(secondaryPct)}
                    </span>
                  </div>
                  <input
                    id="settings-split-slider"
                    type="range"
                    min={0}
                    max={100}
                    step={2.5}
                    value={primaryPct}
                    aria-label={`${primaryName} weekly study percentage`}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      updatePrefs((prev) => ({
                        ...prev,
                        enrolledCourses: updateCourseWeightWithRebalance(
                          prev.enrolledCourses,
                          primary.courseId,
                          val,
                          true
                        ),
                      }));
                    }}
                    className="w-full accent-[var(--accent)]"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {TWO_COURSE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          updatePrefs((prev) => ({
                            ...prev,
                            enrolledCourses: applyTwoCoursePreset(
                              prev.enrolledCourses,
                              primary.courseId,
                              preset.primary
                            ),
                          }))
                        }
                        className={`min-h-[36px] rounded-full px-3 text-[12px] font-medium tabular-nums ${
                          Math.abs(primaryPct - preset.primary) < 0.3
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--bg-inset)] text-[var(--ink-secondary)]"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {activeEnrollments.length >= 3 && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updatePrefs((prev) => {
                        const nextLock = !prev.rebalanceLocked;
                        return {
                          ...prev,
                          rebalanceLocked: nextLock,
                          enrolledCourses: nextLock
                            ? rebalanceEnrolledCourses(prev.enrolledCourses)
                            : prev.enrolledCourses,
                        };
                      })
                    }
                    className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-[12px] font-medium ${
                      prefs.rebalanceLocked
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "bg-[var(--bg-inset)] text-[var(--ink-secondary)]"
                    }`}
                  >
                    <Lock className="h-3.5 w-3.5" strokeWidth={1.9} />
                    <span>Rebalance to 100%</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updatePrefs((prev) => ({
                        ...prev,
                        enrolledCourses: applyEqualSplitAcrossActive(
                          prev.enrolledCourses
                        ),
                      }))
                    }
                    className="min-h-[36px] rounded-full bg-[var(--bg-inset)] px-3 text-[12px] font-medium text-[var(--ink-secondary)]"
                  >
                    Equal Split
                  </button>
                </div>

                <div className="space-y-2.5">
                  {activeEnrollments.map((course) => {
                    const label = resolveCourseDisplayName(
                      course.courseId,
                      library.descriptorsByCourseId.get(course.courseId),
                      course.activeVariantId
                    );
                    const pct =
                      normalizedWeights[course.courseId] ?? course.weightPercent;
                    return (
                      <div key={course.courseId} className="space-y-1">
                        <div className="flex items-center justify-between text-[13px] font-medium tabular-nums">
                          <span>{label}</span>
                          <span>{formatPercentHuman(pct)}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={2.5}
                          value={pct}
                          aria-label={`${label} weekly study percentage`}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            updatePrefs((prev) => ({
                              ...prev,
                              enrolledCourses: updateCourseWeightWithRebalance(
                                prev.enrolledCourses,
                                course.courseId,
                                val,
                                prev.rebalanceLocked
                              ),
                            }));
                          }}
                          className="w-full accent-[var(--accent)]"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[14px] font-medium">Session Length</div>
                <div className="text-[12px] text-[var(--ink-secondary)]">
                  Focus block timer
                </div>
              </div>
              <select
                value={prefs.focusSessionMinutes}
                onChange={(e) =>
                  updatePrefs({ focusSessionMinutes: Number(e.target.value) })
                }
                className="min-h-[42px] rounded-xl bg-[var(--bg-inset)] px-3 text-[14px] font-medium tabular-nums"
              >
                <option value={25}>25 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[14px] font-medium">Sessions / Day</div>
                <div className="text-[12px] text-[var(--ink-secondary)]">
                  Daily schedule blocks
                </div>
              </div>
              <select
                value={prefs.focusSessionsPerDay}
                onChange={(e) =>
                  updatePrefs({ focusSessionsPerDay: Number(e.target.value) })
                }
                className="min-h-[42px] rounded-xl bg-[var(--bg-inset)] px-3 text-[14px] font-medium tabular-nums"
              >
                <option value={1}>1 / day</option>
                <option value={2}>2 / day</option>
                <option value={3}>3 / day</option>
                <option value={4}>4 / day</option>
              </select>
            </div>
          </div>

          {activeEnrollments.length > 0 && (
            <div className="py-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {activeEnrollments.map((course) => {
                const label = resolveCourseDisplayName(
                  course.courseId,
                  library.descriptorsByCourseId.get(course.courseId),
                  course.activeVariantId
                );
                return (
                  <label
                    key={course.courseId}
                    className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2"
                  >
                    <span className="block text-[12px] text-[var(--ink-secondary)] truncate">
                      {label} Goal Date
                    </span>
                    <input
                      type="date"
                      value={course.goalDate}
                      onChange={(e) => {
                        const nextDate = e.target.value;
                        updatePrefs((prev) => {
                          const existing = prev.enrolledCourses[course.courseId];
                          if (!existing) return prev;
                          return {
                            ...prev,
                            enrolledCourses: {
                              ...prev.enrolledCourses,
                              [course.courseId]: {
                                ...existing,
                                goalDate: nextDate,
                              },
                            },
                          };
                        });
                      }}
                      className="mt-0.5 w-full bg-transparent text-[14px] font-medium"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section className="hig-card divide-y divide-[var(--hairline)] px-4">
          <div className="py-3.5 space-y-2.5">
            <div className="text-[15px] font-semibold">
              Phrase Lock Automation
            </div>
            <div className="space-y-1.5">
              <div className="text-[13px] text-[var(--ink-secondary)]">
                Required Speech Accuracy
              </div>
              <SegmentedControl<"60" | "75" | "90">
                id="settings-lock-accuracy"
                ariaLabel="Phrase Lock speech accuracy"
                compact
                value={String(prefs.phraseLockAccuracy) as "60" | "75" | "90"}
                onChange={(val) =>
                  updatePrefs({
                    phraseLockAccuracy: Number(val) as 60 | 75 | 90,
                  })
                }
                options={[
                  { value: "60", label: "60% Relaxed" },
                  { value: "75", label: "75% Balanced" },
                  { value: "90", label: "90% Strict" },
                ]}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[14px] font-medium">Unlock Window</span>
              <select
                value={prefs.phraseLockDurationMinutes}
                onChange={(e) =>
                  updatePrefs({
                    phraseLockDurationMinutes: Number(e.target.value),
                  })
                }
                className="min-h-[42px] rounded-xl bg-[var(--bg-inset)] px-3 text-[14px] font-medium tabular-nums"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </div>
          </div>

          <div className="py-3.5 space-y-2.5">
            <div className="text-[14px] font-medium">
              iOS Shortcuts App Shield Helper
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--ink-secondary)]">
              Create a Personal Automation in iOS Shortcuts (“When app is opened → Open URLs”) using this link:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SHORTCUT_APP_PRESETS.map((preset, idx) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setShortcutPresetIdx(idx)}
                  className={`min-h-[38px] rounded-full px-3 text-[12px] font-medium ${
                    idx === shortcutPresetIdx
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--bg-inset)] text-[var(--ink-secondary)]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              id="settings-copy-shortcut-url"
              type="button"
              onClick={() => void handleCopyShortcutUrl()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--bg-inset)] px-4 text-[14px] font-semibold text-[var(--accent)]"
            >
              {copiedShortcut ? (
                <>
                  <Check className="h-4 w-4" strokeWidth={2} />
                  <span>Copied {chosenShortcut.label} Lock URL</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" strokeWidth={1.9} />
                  <span>Copy iOS Shortcuts URL ({chosenShortcut.label})</span>
                </>
              )}
            </button>
          </div>
        </section>

        <section className="hig-card divide-y divide-[var(--hairline)] px-4">
          <div className="py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-medium">
                Auto-download next 2 units on Wi-Fi
              </div>
              <div className="text-[12px] text-[var(--ink-secondary)]">
                Prefetches upcoming shards matching your goal tier
              </div>
            </div>
            <SwitchToggle
              id="settings-wifi-autodownload"
              checked={prefs.autoDownloadWifi}
              onChange={(next) => updatePrefs({ autoDownloadWifi: next })}
              ariaLabel="Auto-download next 2 units on Wi-Fi"
            />
          </div>

          <div className="py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-medium">Offline Storage</div>
              <div className="text-[12px] text-[var(--ink-secondary)] tabular-nums">
                {formatBytesHuman(library.totalStorageBytes)} across{" "}
                {library.installedMetas.length} installed{" "}
                {library.installedMetas.length === 1 ? "unit" : "units"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void library.refreshCatalog()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--bg-inset)] px-3.5 text-[13px] font-medium text-[var(--ink-primary)]"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>Check Updates</span>
            </button>
          </div>

          <div className="py-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch
                  className="h-4 w-4 text-[var(--accent)]"
                  strokeWidth={1.9}
                />
                <span className="text-[15px] font-semibold">
                  Course Repository
                </span>
              </div>
              <button
                type="button"
                onClick={handleResetRepoDefaults}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--bg-inset)] px-2.5 text-[12px] font-medium text-[var(--ink-secondary)]"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={1.9} />
                <span>Reset Default</span>
              </button>
            </div>

            <SegmentedControl<"public" | "private">
              id="settings-repo-transport-mode"
              ariaLabel="Course repository transport mode"
              compact
              value={repoDraft.mode}
              onChange={(mode) => setRepoDraft((prev) => ({ ...prev, mode }))}
              options={[
                { value: "public", label: "Public Direct" },
                { value: "private", label: "Private Token" },
              ]}
            />

            {import.meta.env.DEV && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg-inset)] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">
                    Use Local Workspace Curriculum
                  </div>
                  <div className="text-[11px] text-[var(--ink-secondary)]">
                    Serves local /curriculum/* directly via Vite dev middleware
                  </div>
                </div>
                <SwitchToggle
                  id="settings-local-workspace-toggle"
                  checked={repoDraft.useLocalWorkspace}
                  onChange={(next) =>
                    setRepoDraft((prev) => ({
                      ...prev,
                      useLocalWorkspace: next,
                    }))
                  }
                  ariaLabel="Use Local Workspace Curriculum"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2">
                <span className="block text-[11px] text-[var(--ink-secondary)]">
                  Owner
                </span>
                <input
                  id="settings-repo-owner"
                  type="text"
                  value={repoDraft.owner}
                  onChange={(e) =>
                    setRepoDraft((prev) => ({ ...prev, owner: e.target.value }))
                  }
                  placeholder={BRAND.curriculumRepo.owner}
                  className="mt-0.5 w-full bg-transparent text-[13px] font-mono text-[var(--ink-primary)] placeholder:text-[var(--ink-secondary)]"
                />
              </label>

              <label className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2">
                <span className="block text-[11px] text-[var(--ink-secondary)]">
                  Repository
                </span>
                <input
                  id="settings-repo-name"
                  type="text"
                  value={repoDraft.repo}
                  onChange={(e) =>
                    setRepoDraft((prev) => ({ ...prev, repo: e.target.value }))
                  }
                  placeholder={BRAND.curriculumRepo.repo}
                  className="mt-0.5 w-full bg-transparent text-[13px] font-mono text-[var(--ink-primary)] placeholder:text-[var(--ink-secondary)]"
                />
              </label>

              <label className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2">
                <span className="block text-[11px] text-[var(--ink-secondary)]">
                  Branch
                </span>
                <input
                  id="settings-repo-branch"
                  type="text"
                  value={repoDraft.branch}
                  onChange={(e) =>
                    setRepoDraft((prev) => ({
                      ...prev,
                      branch: e.target.value,
                    }))
                  }
                  placeholder={BRAND.curriculumRepo.branch}
                  className="mt-0.5 w-full bg-transparent text-[13px] font-mono text-[var(--ink-primary)] placeholder:text-[var(--ink-secondary)]"
                />
              </label>
            </div>

            {repoDraft.mode === "private" && (
              <label className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2">
                <span className="block text-[11px] text-[var(--ink-secondary)]">
                  Fine-Grained Personal Access Token (Contents: Read-only)
                </span>
                <input
                  id="settings-repo-token"
                  type="password"
                  autoComplete="off"
                  value={repoDraft.privateToken}
                  onChange={(e) =>
                    setRepoDraft((prev) => ({
                      ...prev,
                      privateToken: e.target.value,
                    }))
                  }
                  placeholder="github_pat_..."
                  className="mt-0.5 w-full bg-transparent text-[13px] font-mono text-[var(--ink-primary)] placeholder:text-[var(--ink-secondary)]"
                />
              </label>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
              <div className="text-[12px] text-[var(--ink-secondary)] truncate">
                Source: {describeActiveEndpoint(repoDraft)}
              </div>
              <button
                id="settings-save-repo-btn"
                type="button"
                onClick={handleSaveRepoConfig}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
              >
                {savedRepoFeedback ? (
                  <>
                    <Check className="h-4 w-4" strokeWidth={2} />
                    <span>Synced</span>
                  </>
                ) : (
                  <span>Save & Sync Repository</span>
                )}
              </button>
            </div>
          </div>
        </section>

        <footer className="px-2 text-center text-[12px] text-[var(--ink-secondary)]">
          {BRAND.appName} · Release 2.0 · Direct-from-repo adaptive curriculum
        </footer>
      </motion.div>
    </div>
  );
}
