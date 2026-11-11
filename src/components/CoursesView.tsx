import {
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudOff,
  Download,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import {
  type LanguageCode,
  TIER_META,
  TIER_ORDER,
} from "../schemas/curriculum";
import {
  computeUnitBytesForTier,
  summarizeInstalledUnit,
} from "../services/courseSyncService";
import type { UserPreferences } from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import { formatBytesHuman } from "../utils/formatters";
import { LessonStudio } from "./LessonStudio";
import { SegmentedControl } from "./ui/SegmentedControl";
import { SwitchToggle } from "./ui/SwitchToggle";

export function CoursesView({
  prefs,
  updatePrefs,
  library,
  activeUnitId,
  onSelectUnit,
}: {
  prefs: UserPreferences;
  updatePrefs: (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void;
  library: OfflineLibraryHandle;
  activeUnitId: string | null;
  onSelectUnit: (unitId: string | null) => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [selectedLang, setSelectedLang] = useState<LanguageCode>("ja");
  const [goalsExpanded, setGoalsExpanded] = useState<boolean>(false);
  const [expandedUpcomingStages, setExpandedUpcomingStages] = useState<
    Record<string, boolean>
  >({});
  const [isBatchSyncing, setIsBatchSyncing] = useState<boolean>(false);

  if (activeUnitId && (library.shardsByUnitId.get(activeUnitId)?.length ?? 0) > 0) {
    return (
      <LessonStudio
        unitId={activeUnitId}
        prefs={prefs}
        updatePrefs={updatePrefs}
        library={library}
        onClose={() => onSelectUnit(null)}
      />
    );
  }

  const activeTier = prefs.tiers[selectedLang];
  const langManifest = library.manifest?.languages[selectedLang] ?? null;
  const langBlueprint = library.blueprint?.languages[selectedLang] ?? null;

  const publishedByNumber = new Map(
    (langManifest?.units ?? []).map((u) => [u.unitNumber, u])
  );

  const stages =
    langManifest?.stages ??
    langBlueprint?.stages ??
    [];

  const missingUpgradeForLang =
    library.outdatedOrUpgradeUnits.missingTierUnits[selectedLang];
  const outdatedList = library.outdatedOrUpgradeUnits.outdatedUnits;

  const handleBatchDeltaUpgrade = async () => {
    setIsBatchSyncing(true);
    try {
      await library.syncUnitUpdatesOrUpgrades(
        missingUpgradeForLang.units.map((unit) => ({
          unit,
          lang: selectedLang,
        }))
      );
    } catch {
      // Per-unit error banner surfaces automatically
    } finally {
      setIsBatchSyncing(false);
    }
  };

  const handleBatchManifestUpdate = async () => {
    setIsBatchSyncing(true);
    try {
      await library.syncUnitUpdatesOrUpgrades(outdatedList);
    } catch {
      // Per-unit error banner surfaces automatically
    } finally {
      setIsBatchSyncing(false);
    }
  };

  const activeDownloads = Object.values(library.downloadProgress);

  return (
    <div className="space-y-4">
      <div className="sr-only" aria-live="polite">
        {activeDownloads.length > 0
          ? `Downloading ${activeDownloads[0].activeShardLabel} (${formatBytesHuman(
              activeDownloads[0].loadedBytes
            )} of ${formatBytesHuman(activeDownloads[0].totalBytes)})`
          : ""}
      </div>

      <section aria-labelledby="courses-heading" className="hig-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1
              id="courses-heading"
              className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]"
            >
              Courses
            </h1>
            <p className="mt-1 text-[14px] text-[var(--ink-secondary)]">
              Download units on demand — matched strictly to your goal tier.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {outdatedList.length > 0 && (
              <button
                id="courses-update-available-pill"
                type="button"
                disabled={isBatchSyncing}
                onClick={() => void handleBatchManifestUpdate()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3.5 text-[13px] font-semibold text-[var(--accent)]"
              >
                <ArrowUpCircle className="h-4 w-4" strokeWidth={2} />
                <span>Update Available ({outdatedList.length})</span>
              </button>
            )}

            <button
              id="courses-learning-goals-btn"
              type="button"
              aria-expanded={goalsExpanded}
              onClick={() => setGoalsExpanded((v) => !v)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--bg-pill)] px-3.5 text-[13px] font-medium text-[var(--ink-primary)]"
            >
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
              <span>Learning Goals</span>
            </button>
          </div>
        </div>

        <SegmentedControl<LanguageCode>
          id="courses-lang-switcher"
          ariaLabel="Select course language"
          value={selectedLang}
          onChange={setSelectedLang}
          options={[
            {
              value: "ja",
              label: `Japanese · ${TIER_META[prefs.tiers.ja].shortLabel}`,
            },
            {
              value: "de",
              label: `${prefs.austrianMode ? "Austrian " : ""}German · ${
                TIER_META[prefs.tiers.de].shortLabel
              }`,
            },
          ]}
        />

        <AnimatePresence initial={false}>
          {goalsExpanded && (
            <motion.div
              key="learning-goals-drawer"
              initial={
                prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -6 }
              }
              animate={{ opacity: 1, y: 0 }}
              exit={
                prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }
              }
              transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
              className="hig-inset p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[14px] font-semibold">
                  {selectedLang === "ja" ? "Japanese" : "German"} Understanding Tier
                </div>
                <span className="text-[12px] text-[var(--ink-secondary)]">
                  Tiers 1–{TIER_META[activeTier].number} active
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TIER_ORDER.map((tier) => {
                  const isSelected = activeTier === tier;
                  return (
                    <button
                      key={tier}
                      id={`goal-tier-${selectedLang}-${tier}`}
                      type="button"
                      onClick={() =>
                        updatePrefs((prev) => ({
                          ...prev,
                          tiers: { ...prev.tiers, [selectedLang]: tier },
                        }))
                      }
                      className={`min-h-[48px] rounded-xl px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "bg-[var(--accent)] text-white"
                          : "bg-[var(--bg-elevated)] text-[var(--ink-primary)]"
                      }`}
                    >
                      <div className="text-[13px] font-semibold">
                        {TIER_META[tier].label}
                      </div>
                      <div
                        className={`text-[11px] ${
                          isSelected
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
                {selectedLang === "ja"
                  ? TIER_META[activeTier].descriptionJa
                  : TIER_META[activeTier].descriptionDe}
              </p>

              {selectedLang === "de" && (
                <div className="hig-hairline-t pt-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">
                      Austrian Regional Focus (de-AT)
                    </div>
                    <div className="text-[12px] text-[var(--ink-secondary)]">
                      Uses Austrian audio and regional lexicon alongside Standard German notes
                    </div>
                  </div>
                  <SwitchToggle
                    id="courses-austrian-toggle"
                    checked={prefs.austrianMode}
                    onChange={(next) => updatePrefs({ austrianMode: next })}
                    ariaLabel="Toggle Austrian German mode"
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {library.isOffline && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--bg-card)] px-4 py-3 text-[13px] text-[var(--ink-secondary)]">
          <div className="flex items-center gap-2 min-w-0">
            <CloudOff className="h-4 w-4 shrink-0 text-[var(--ink-secondary)]" strokeWidth={1.8} />
            <span>
              Offline mode — downloaded units open immediately; new downloads resume once online.
            </span>
          </div>
        </div>
      )}

      {missingUpgradeForLang.units.length > 0 && (
        <div className="hig-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-[var(--ink-primary)]">
              Tier upgrade ready for {missingUpgradeForLang.units.length} installed{" "}
              {missingUpgradeForLang.units.length === 1 ? "unit" : "units"}
            </div>
            <div className="text-[13px] text-[var(--ink-secondary)] tabular-nums">
              Downloads only the missing {TIER_META[activeTier].label} delta shards (
              {formatBytesHuman(missingUpgradeForLang.deltaBytes)}).
            </div>
          </div>
          <motion.button
            id="courses-delta-upgrade-btn"
            type="button"
            disabled={isBatchSyncing}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
            onClick={() => void handleBatchDeltaUpgrade()}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[14px] font-semibold text-white disabled:opacity-60"
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            <span>Sync Delta ({formatBytesHuman(missingUpgradeForLang.deltaBytes)})</span>
          </motion.button>
        </div>
      )}

      {library.isSyncingCatalog && !library.manifest && (
        <div className="space-y-3" aria-label="Loading course catalog">
          {[1, 2, 3].map((skeleton) => (
            <div key={skeleton} className="hig-card p-5 space-y-3 animate-pulse">
              <div className="h-5 w-48 rounded-lg bg-[var(--bg-inset)]" />
              <div className="h-4 w-72 max-w-full rounded-lg bg-[var(--bg-inset)]" />
              <div className="h-14 w-full rounded-xl bg-[var(--bg-inset)]" />
            </div>
          ))}
        </div>
      )}

      {library.catalogError && !library.manifest && (
        <div className="hig-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h2 className="text-[16px] font-semibold text-[var(--status-danger)]">
              Unable to load curriculum index
            </h2>
            <p className="text-[13px] text-[var(--ink-secondary)] break-words">
              {library.catalogError}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void library.refreshCatalog()}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[14px] font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
            <span>Retry</span>
          </button>
        </div>
      )}

      <div className="space-y-4">
        {stages.map((stage) => {
          const publishedInStage = (langManifest?.units ?? []).filter(
            (u) => u.stageId === stage.id
          );
          const blueprintUnitsInStage = (langBlueprint?.units ?? []).filter(
            (u) =>
              u.stageId === stage.id && !publishedByNumber.has(u.unitNumber)
          );
          const upcomingOpen = Boolean(expandedUpcomingStages[stage.id]);

          return (
            <section
              key={stage.id}
              aria-labelledby={`heading-${stage.id}`}
              className="hig-card p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2
                    id={`heading-${stage.id}`}
                    className="text-[17px] font-semibold text-[var(--ink-primary)]"
                  >
                    {stage.label}
                  </h2>
                  <p className="mt-0.5 text-[13px] text-[var(--ink-secondary)]">
                    {stage.summary}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink-secondary)]">
                  {stage.cefrOrJlpt}
                </span>
              </div>

              {publishedInStage.length > 0 && (
                <div className="divide-y divide-[var(--hairline)]">
                  {publishedInStage.map((unit) => {
                    const localShards =
                      library.shardsByUnitId.get(unit.unitId) ?? [];
                    const summary = summarizeInstalledUnit(
                      unit,
                      activeTier,
                      localShards
                    );
                    const { totalTargetBytes, deltaBytesToFetch } =
                      computeUnitBytesForTier(unit, activeTier, localShards);
                    const progress = library.downloadProgress[unit.unitId];
                    const unitError = library.downloadErrors[unit.unitId];
                    const isCompleted = library.completionByUnitId.has(
                      unit.unitId
                    );
                    const hasAnyCached = localShards.length > 0;

                    return (
                      <div
                        key={unit.unitId}
                        className="py-3.5 first:pt-1 last:pb-1 space-y-2.5 min-w-0"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <button
                            id={`unit-open-${unit.unitId}`}
                            type="button"
                            disabled={!hasAnyCached}
                            onClick={() => {
                              if (hasAnyCached) {
                                onSelectUnit(unit.unitId);
                              }
                            }}
                            className={`min-w-0 flex-1 text-left ${
                              hasAnyCached
                                ? "cursor-pointer group"
                                : "cursor-default"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[15px] font-semibold text-[var(--ink-primary)] group-hover:text-[var(--accent)] transition-colors">
                                Unit {unit.unitNumber} · {unit.title}
                              </span>
                              {summary.isReadyForGoal && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-success-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--status-success)]">
                                  <CheckCircle2
                                    className="h-3 w-3"
                                    strokeWidth={2.2}
                                  />
                                  <span>Offline</span>
                                </span>
                              )}
                              {isCompleted && (
                                <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                                  Completed
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[13px] text-[var(--ink-secondary)] break-words">
                              {unit.subtitle}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[12px] text-[var(--ink-secondary)] tabular-nums">
                              <span>{unit.estimatedMinutes}m lesson</span>
                              <span>·</span>
                              <span>
                                {hasAnyCached
                                  ? `${formatBytesHuman(
                                      summary.installedBytes
                                    )} stored`
                                  : `${formatBytesHuman(
                                      totalTargetBytes
                                    )} for ${TIER_META[activeTier].shortLabel}`}
                              </span>
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-2">
                            {hasAnyCached && summary.isReadyForGoal ? (
                              <>
                                <motion.button
                                  type="button"
                                  whileTap={
                                    prefersReducedMotion
                                      ? undefined
                                      : { scale: 0.97 }
                                  }
                                  onClick={() => onSelectUnit(unit.unitId)}
                                  className="inline-flex min-h-[44px] items-center gap-1 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
                                >
                                  <span>Study</span>
                                  <ChevronRight
                                    className="h-4 w-4"
                                    strokeWidth={2}
                                  />
                                </motion.button>
                                <button
                                  id={`remove-download-${unit.unitId}`}
                                  type="button"
                                  onClick={() =>
                                    void library.removeUnit(unit.unitId)
                                  }
                                  aria-label={`Remove offline download for Unit ${unit.unitNumber}`}
                                  title="Remove download (keeps flashcard history)"
                                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-secondary)] hover:text-[var(--status-danger)]"
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                                </button>
                              </>
                            ) : (
                              <motion.button
                                id={`download-unit-${unit.unitId}`}
                                type="button"
                                disabled={Boolean(progress)}
                                whileTap={
                                  prefersReducedMotion
                                    ? undefined
                                    : { scale: 0.97 }
                                }
                                onClick={() =>
                                  void library
                                    .downloadUnit(unit, selectedLang)
                                    .catch(() => undefined)
                                }
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--bg-inset)] px-4 text-[13px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-60 tabular-nums"
                              >
                                {progress ? (
                                  <>
                                    <RefreshCw
                                      className="h-3.5 w-3.5 animate-spin"
                                      strokeWidth={2}
                                    />
                                    <span>
                                      {formatBytesHuman(progress.loadedBytes)}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Download
                                      className="h-4 w-4"
                                      strokeWidth={2}
                                    />
                                    <span>
                                      {hasAnyCached
                                        ? `+${formatBytesHuman(
                                            deltaBytesToFetch
                                          )} Upgrade`
                                        : `Download (${formatBytesHuman(
                                            totalTargetBytes
                                          )})`}
                                    </span>
                                  </>
                                )}
                              </motion.button>
                            )}
                          </div>
                        </div>

                        {progress && (
                          <div className="space-y-1">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
                              <div
                                className="h-full rounded-full bg-[var(--accent)] transition-all duration-150"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.max(
                                      10,
                                      Math.round(
                                        (progress.loadedBytes /
                                          Math.max(1, progress.totalBytes)) *
                                          100
                                      )
                                    )
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {unitError && (
                          <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--status-danger-bg)] px-3 py-2 text-[12px] text-[var(--status-danger)]">
                            <span className="min-w-0 break-words">
                              {unitError}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                void library
                                  .downloadUnit(unit, selectedLang)
                                  .catch(() => undefined)
                              }
                              className="shrink-0 font-semibold underline"
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {blueprintUnitsInStage.length > 0 && (
                <div className={publishedInStage.length > 0 ? "hig-hairline-t pt-2.5" : ""}>
                  <button
                    type="button"
                    aria-expanded={upcomingOpen}
                    onClick={() =>
                      setExpandedUpcomingStages((prev) => ({
                        ...prev,
                        [stage.id]: !prev[stage.id],
                      }))
                    }
                    className="flex min-h-[42px] w-full items-center justify-between text-left text-[13px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  >
                    <span className="tabular-nums">
                      {upcomingOpen ? "Hide" : "View"} {blueprintUnitsInStage.length}{" "}
                      upcoming daily syllabus units in {stage.cefrOrJlpt}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-150 ${
                        upcomingOpen ? "rotate-180" : ""
                      }`}
                      strokeWidth={1.8}
                    />
                  </button>

                  {upcomingOpen && (
                    <div className="mt-2 divide-y divide-[var(--hairline)] rounded-xl bg-[var(--bg-inset)] px-3.5">
                      {blueprintUnitsInStage.map((bp) => (
                        <div
                          key={bp.unitId}
                          className="flex items-center justify-between gap-3 py-2.5 text-[13px] min-w-0"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[var(--ink-primary)] truncate">
                              Unit {bp.unitNumber} · {bp.title}
                            </div>
                            <div className="text-[12px] text-[var(--ink-secondary)] truncate">
                              {bp.communicativeGoal}
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-[var(--bg-elevated)] px-2.5 py-0.5 text-[11px] text-[var(--ink-secondary)]">
                            Daily Queue
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
