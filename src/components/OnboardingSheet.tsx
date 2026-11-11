import {
  ArrowRight,
  Calendar,
  Check,
  Download,
  RefreshCw,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { BRAND } from "../config/brand";
import {
  TIER_META,
  TIER_ORDER,
  type UnderstandingTier,
} from "../schemas/curriculum";
import { computeUnitBytesForTier } from "../services/courseSyncService";
import type { UserPreferences } from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import {
  computeDaysRemaining,
  computeWeeklyHoursSplit,
  formatBytesHuman,
  formatGoalDateHuman,
} from "../utils/formatters";
import { resolveTransition, SHEET_SPRING } from "../utils/motionPresets";
import { SwitchToggle } from "./ui/SwitchToggle";

const SPLIT_PRESETS = [
  { label: "92.5 / 7.5", ja: 92.5 },
  { label: "80 / 20", ja: 80 },
  { label: "50 / 50", ja: 50 },
] as const;

export function OnboardingSheet({
  prefs,
  updatePrefs,
  library,
}: {
  prefs: UserPreferences;
  updatePrefs: (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void;
  library: OfflineLibraryHandle;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isDownloadingStarter, setIsDownloadingStarter] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);

  const transition = resolveTransition(prefersReducedMotion, SHEET_SPRING);

  const jaUnit1 = library.manifest?.languages.ja.units[0] ?? null;
  const deUnit1 = library.manifest?.languages.de.units[0] ?? null;

  const jaStarterBytes = jaUnit1
    ? computeUnitBytesForTier(jaUnit1, prefs.tiers.ja).deltaBytesToFetch
    : 44_000;
  const deStarterBytes = deUnit1
    ? computeUnitBytesForTier(deUnit1, prefs.tiers.de).deltaBytesToFetch
    : 14_000;
  const totalStarterBytes = jaStarterBytes + deStarterBytes;

  const weeklySplit = computeWeeklyHoursSplit(
    prefs.focusSessionsPerDay,
    prefs.focusSessionMinutes,
    prefs.japaneseSplitPercent
  );

  const setTier = (lang: "ja" | "de", tier: UnderstandingTier) => {
    updatePrefs((prev) => ({
      ...prev,
      tiers: { ...prev.tiers, [lang]: tier },
    }));
  };

  const handleDownloadStarters = async () => {
    setStarterError(null);
    setIsDownloadingStarter(true);
    try {
      if (!library.manifest) {
        await library.refreshCatalog();
      }
      const latestJa = library.manifest?.languages.ja.units[0];
      const latestDe = library.manifest?.languages.de.units[0];
      if (!latestJa || !latestDe) {
        throw new Error(
          "Starter units could not be loaded right now. Check your connection and retry."
        );
      }
      if (prefs.japaneseSplitPercent > 0) {
        await library.downloadUnit(latestJa, "ja", prefs.tiers.ja);
      }
      if (prefs.japaneseSplitPercent < 100) {
        await library.downloadUnit(latestDe, "de", prefs.tiers.de);
      }
      updatePrefs({ onboardingCompleted: true });
    } catch (err) {
      setStarterError(
        err instanceof Error
          ? err.message
          : "Download failed. Please check your connection and try again."
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
          prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 36, scale: 0.98 }
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
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }}
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
                  Choose how deep you want to go in each language. {BRAND.appName}{" "}
                  downloads only the lesson tiers that match your goal.
                </p>
              </div>

              <div className="hig-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[16px] font-semibold">Japanese Goal</h2>
                  <span className="rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink-secondary)]">
                    Kana to JLPT N1
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {TIER_ORDER.map((tier) => {
                    const active = prefs.tiers.ja === tier;
                    return (
                      <button
                        key={tier}
                        id={`onboard-ja-tier-${tier}`}
                        type="button"
                        onClick={() => setTier("ja", tier)}
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
                            active ? "text-white/85" : "text-[var(--ink-secondary)]"
                          }`}
                        >
                          Tier {TIER_META[tier].number}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--ink-secondary)]">
                  {TIER_META[prefs.tiers.ja].descriptionJa}
                </p>
              </div>

              <div className="hig-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[16px] font-semibold">German Goal</h2>
                  <span className="rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink-secondary)]">
                    Roots to CEFR C1
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {TIER_ORDER.map((tier) => {
                    const active = prefs.tiers.de === tier;
                    return (
                      <button
                        key={tier}
                        id={`onboard-de-tier-${tier}`}
                        type="button"
                        onClick={() => setTier("de", tier)}
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
                            active ? "text-white/85" : "text-[var(--ink-secondary)]"
                          }`}
                        >
                          Tier {TIER_META[tier].number}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--ink-secondary)]">
                  {TIER_META[prefs.tiers.de].descriptionDe}
                </p>

                <div className="hig-hairline-t pt-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-[var(--ink-primary)]">
                      Austrian Regional Focus
                    </div>
                    <div className="text-[12px] text-[var(--ink-secondary)]">
                      Prioritizes Austrian phrasing (Grüß Gott, Sackerl, ÖBB Bahnsteig) and audio
                    </div>
                  </div>
                  <SwitchToggle
                    id="onboard-austrian-switch"
                    checked={prefs.austrianMode}
                    onChange={(checked) => updatePrefs({ austrianMode: checked })}
                    ariaLabel="Toggle Austrian Regional Focus"
                  />
                </div>
              </div>

              <motion.button
                id="onboard-next-1"
                type="button"
                whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                onClick={() => setStep(2)}
                className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-white"
              >
                <span>Continue to Weekly Rhythm</span>
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </motion.button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="onboard-step-2"
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }}
              transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
              className="space-y-4"
            >
              <div>
                <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
                  Set Your Weekly Split
                </h1>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--ink-secondary)]">
                  Balance your study sessions, flashcard reviews, and Phrase Lock prompts across both languages.
                </p>
              </div>

              <div className="hig-card p-4 space-y-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold tabular-nums">
                    {prefs.japaneseSplitPercent}% Japanese
                  </span>
                  <span className="text-[15px] font-semibold text-[var(--ink-secondary)] tabular-nums">
                    {Number((100 - prefs.japaneseSplitPercent).toFixed(1))}% German
                  </span>
                </div>

                <input
                  id="onboard-split-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={2.5}
                  value={prefs.japaneseSplitPercent}
                  aria-label="Weekly Japanese percentage"
                  onChange={(e) =>
                    updatePrefs({ japaneseSplitPercent: Number(e.target.value) })
                  }
                  className="w-full accent-[var(--accent)] h-2 cursor-pointer"
                />

                <div className="flex flex-wrap gap-2">
                  {SPLIT_PRESETS.map((preset) => {
                    const selected = prefs.japaneseSplitPercent === preset.ja;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          updatePrefs({ japaneseSplitPercent: preset.ja })
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

                <div className="hig-hairline-t pt-3 flex items-center justify-between text-[13px] text-[var(--ink-secondary)] tabular-nums">
                  <span>Weekly Focus Allocation</span>
                  <span className="font-semibold text-[var(--ink-primary)]">
                    {weeklySplit.jaHoursLabel} · {weeklySplit.deHoursLabel}
                  </span>
                </div>
              </div>

              <div className="hig-card divide-y divide-[var(--hairline)] px-4">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-[14px] font-medium">Daily Focus Sessions</div>
                    <div className="text-[12px] text-[var(--ink-secondary)] tabular-nums">
                      {prefs.focusSessionsPerDay} × {prefs.focusSessionMinutes}m blocks
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => updatePrefs({ focusSessionsPerDay: count })}
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
                      updatePrefs({ dailyPracticeMinutes: Number(e.target.value) })
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
                    <label className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2">
                      <span className="block text-[12px] text-[var(--ink-secondary)]">
                        Japan Goal Date
                        {prefs.goalDates.ja
                          ? ` · ${
                              computeDaysRemaining(prefs.goalDates.ja)?.label ??
                              formatGoalDateHuman(prefs.goalDates.ja)
                            }`
                          : ""}
                      </span>
                      <input
                        type="date"
                        value={prefs.goalDates.ja}
                        onChange={(e) =>
                          updatePrefs((prev) => ({
                            ...prev,
                            goalDates: { ...prev.goalDates, ja: e.target.value },
                          }))
                        }
                        className="mt-0.5 w-full bg-transparent text-[14px] font-medium"
                      />
                    </label>
                    <label className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2">
                      <span className="block text-[12px] text-[var(--ink-secondary)]">
                        {prefs.austrianMode ? "Austria" : "Germany"} Goal Date
                        {prefs.goalDates.de
                          ? ` · ${
                              computeDaysRemaining(prefs.goalDates.de)?.label ??
                              formatGoalDateHuman(prefs.goalDates.de)
                            }`
                          : ""}
                      </span>
                      <input
                        type="date"
                        value={prefs.goalDates.de}
                        onChange={(e) =>
                          updatePrefs((prev) => ({
                            ...prev,
                            goalDates: { ...prev.goalDates, de: e.target.value },
                          }))
                        }
                        className="mt-0.5 w-full bg-transparent text-[14px] font-medium"
                      />
                    </label>
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
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }}
              transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
              className="space-y-4"
            >
              <div>
                <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
                  Download Starter Units
                </h1>
                <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--ink-secondary)]">
                  Fetch Unit 1 for offline Guided lessons, Hands-Free audio loops, flashcards, and graded stories.
                </p>
              </div>

              <div className="hig-card divide-y divide-[var(--hairline)] px-4">
                <div className="flex items-center justify-between py-3.5 gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold truncate">
                      {jaUnit1?.title ?? "Japanese Unit 1 · Greetings & Konbini"}
                    </div>
                    <div className="text-[13px] text-[var(--ink-secondary)]">
                      Japanese · {TIER_META[prefs.tiers.ja].label} (Tiers 1–
                      {TIER_META[prefs.tiers.ja].number})
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[13px] font-medium text-[var(--ink-secondary)] tabular-nums">
                    {formatBytesHuman(jaStarterBytes)}
                  </span>
                </div>

                <div className="flex items-center justify-between py-3.5 gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold truncate">
                      {deUnit1?.title ?? "German Unit 1 · Austrian Greetings & Café"}
                    </div>
                    <div className="text-[13px] text-[var(--ink-secondary)]">
                      {prefs.austrianMode ? "Austrian German" : "German"} ·{" "}
                      {TIER_META[prefs.tiers.de].label} (
                      {TIER_META[prefs.tiers.de].number === 1
                        ? "Tier 1 only"
                        : `Tiers 1–${TIER_META[prefs.tiers.de].number}`}
                      )
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[13px] font-medium text-[var(--ink-secondary)] tabular-nums">
                    {formatBytesHuman(deStarterBytes)}
                  </span>
                </div>

                <div className="flex items-center justify-between py-3 text-[13px] text-[var(--ink-secondary)]">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.8} />
                    <span>Cached locally for instant offline study</span>
                  </span>
                  <span className="font-semibold text-[var(--ink-primary)] tabular-nums">
                    Total {formatBytesHuman(totalStarterBytes)}
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
                        {formatBytesHuman(totalStarterBytes)}
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
                                (activeProgressBytes / Math.max(1, totalStarterBytes)) *
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
                      You appear to be offline. Connect briefly to download Unit 1, or explore the app shell first.
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
                      <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} />
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
                    onClick={() => updatePrefs({ onboardingCompleted: true })}
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
