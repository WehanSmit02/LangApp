import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type CardReviewRecord,
  type DailyActivityRecord,
  type LessonCompletionRecord,
  offlineDb,
  type StoredUnitMeta,
  type StoredUnitShard,
  type StoryCompletionRecord,
  toLocalDateKey,
} from "../db/offlineDb";
import {
  type GradedStory,
  isTierIncluded,
  type LanguageCode,
  type Manifest,
  type ManifestUnitEntry,
  type ReferenceSheet,
  type SrsCard,
  type SyllabusBlueprint,
  TIER_ORDER,
  type UnderstandingTier,
} from "../schemas/curriculum";
import {
  computeUnitBytesForTier,
  downloadUnitDeltaShards,
  maybeAutoDownloadNextUnits,
  removeUnitDownload,
  summarizeInstalledUnit,
  syncCatalogIndex,
  type UnitDownloadProgress,
} from "../services/courseSyncService";
import type { UserPreferences } from "./preferences";

const dbChangeListeners = new Set<() => void>();

export function notifyOfflineDbChanged(): void {
  for (const fn of dbChangeListeners) {
    fn();
  }
}

export function useOfflineLibrary(prefs: UserPreferences) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [blueprint, setBlueprint] = useState<SyllabusBlueprint | null>(null);
  const [isSyncingCatalog, setIsSyncingCatalog] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  const [installedMetas, setInstalledMetas] = useState<StoredUnitMeta[]>([]);
  const [installedShards, setInstalledShards] = useState<StoredUnitShard[]>([]);
  const [cardReviews, setCardReviews] = useState<CardReviewRecord[]>([]);
  const [lessonCompletions, setLessonCompletions] = useState<
    LessonCompletionRecord[]
  >([]);
  const [storyCompletions, setStoryCompletions] = useState<
    StoryCompletionRecord[]
  >([]);
  const [todayActivity, setTodayActivity] =
    useState<DailyActivityRecord | null>(null);

  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, UnitDownloadProgress>
  >({});
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>(
    {}
  );

  const reloadLocalTables = useCallback(async () => {
    const todayKey = toLocalDateKey();
    const [metas, shards, reviews, lessons, stories, activity] =
      await Promise.all([
        offlineDb.unitMeta.toArray(),
        offlineDb.unitShards.toArray(),
        offlineDb.cardReviews.toArray(),
        offlineDb.lessonCompletions.toArray(),
        offlineDb.storyCompletions.toArray(),
        offlineDb.dailyActivity.get(todayKey),
      ]);

    setInstalledMetas(metas);
    setInstalledShards(shards);
    setCardReviews(reviews);
    setLessonCompletions(lessons);
    setStoryCompletions(stories);
    setTodayActivity(activity ?? null);
  }, []);

  const fetchCatalogAndApply = useCallback(async () => {
    const outcome = await syncCatalogIndex(prefs.customCurriculumRepo);
    if (outcome.manifest) {
      setManifest(outcome.manifest);
    }
    if (outcome.blueprint) {
      setBlueprint(outcome.blueprint);
    }
    setCatalogError(
      outcome.error && !outcome.manifest ? outcome.error : null
    );
    setIsSyncingCatalog(false);
  }, [prefs.customCurriculumRepo]);

  const refreshCatalog = useCallback(async () => {
    setIsSyncingCatalog(true);
    setCatalogError(null);
    await fetchCatalogAndApply();
  }, [fetchCatalogAndApply]);

  useEffect(() => {
    let active = true;
    const todayKey = toLocalDateKey();
    void Promise.all([
      offlineDb.unitMeta.toArray(),
      offlineDb.unitShards.toArray(),
      offlineDb.cardReviews.toArray(),
      offlineDb.lessonCompletions.toArray(),
      offlineDb.storyCompletions.toArray(),
      offlineDb.dailyActivity.get(todayKey),
    ]).then(([metas, shards, reviews, lessons, stories, activity]) => {
      if (!active) return;
      setInstalledMetas(metas);
      setInstalledShards(shards);
      setCardReviews(reviews);
      setLessonCompletions(lessons);
      setStoryCompletions(stories);
      setTodayActivity(activity ?? null);
    });

    dbChangeListeners.add(reloadLocalTables);
    return () => {
      active = false;
      dbChangeListeners.delete(reloadLocalTables);
    };
  }, [reloadLocalTables]);

  useEffect(() => {
    let active = true;
    void syncCatalogIndex(prefs.customCurriculumRepo).then((outcome) => {
      if (!active) return;
      if (outcome.manifest) {
        setManifest(outcome.manifest);
      }
      if (outcome.blueprint) {
        setBlueprint(outcome.blueprint);
      }
      setCatalogError(
        outcome.error && !outcome.manifest ? outcome.error : null
      );
      setIsSyncingCatalog(false);
    });
    return () => {
      active = false;
    };
  }, [prefs.customCurriculumRepo]);

  useEffect(() => {
    const onOnline = () => {
      setIsOffline(false);
      void refreshCatalog();
    };
    const onOffline = () => setIsOffline(true);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refreshCatalog]);

  const shardsByUnitId = useMemo(() => {
    const map = new Map<string, StoredUnitShard[]>();
    for (const s of installedShards) {
      const list = map.get(s.unitId) ?? [];
      list.push(s);
      map.set(s.unitId, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
      );
    }
    return map;
  }, [installedShards]);

  const metaByUnitId = useMemo(
    () => new Map(installedMetas.map((m) => [m.unitId, m])),
    [installedMetas]
  );

  const completionByUnitId = useMemo(
    () => new Map(lessonCompletions.map((c) => [c.unitId, c])),
    [lessonCompletions]
  );

  const storyCompletionById = useMemo(
    () => new Map(storyCompletions.map((s) => [s.storyId, s])),
    [storyCompletions]
  );

  const reviewByCardId = useMemo(
    () => new Map(cardReviews.map((r) => [r.cardId, r])),
    [cardReviews]
  );

  const totalStorageBytes = useMemo(
    () => installedShards.reduce((sum, s) => sum + s.bytes, 0),
    [installedShards]
  );

  const outdatedOrUpgradeUnits = useMemo(() => {
    if (!manifest) {
      return {
        outdatedUnits: [] as Array<{
          unit: ManifestUnitEntry;
          lang: LanguageCode;
        }>,
        missingTierUnits: {
          ja: { units: [] as ManifestUnitEntry[], deltaBytes: 0 },
          de: { units: [] as ManifestUnitEntry[], deltaBytes: 0 },
        },
      };
    }

    const outdatedUnits: Array<{
      unit: ManifestUnitEntry;
      lang: LanguageCode;
    }> = [];
    const missingTierUnits = {
      ja: { units: [] as ManifestUnitEntry[], deltaBytes: 0 },
      de: { units: [] as ManifestUnitEntry[], deltaBytes: 0 },
    };

    for (const lang of ["ja", "de"] as const) {
      const userTier = prefs.tiers[lang];
      for (const unit of manifest.languages[lang].units) {
        const localShards = shardsByUnitId.get(unit.unitId) ?? [];
        if (localShards.length === 0) continue;

        const summary = summarizeInstalledUnit(unit, userTier, localShards);
        if (summary.outdatedTiers.length > 0) {
          outdatedUnits.push({ unit, lang });
        }
        if (summary.missingTiersForGoal.length > 0) {
          const { deltaBytesToFetch } = computeUnitBytesForTier(
            unit,
            userTier,
            localShards
          );
          missingTierUnits[lang].units.push(unit);
          missingTierUnits[lang].deltaBytes += deltaBytesToFetch;
        }
      }
    }

    return { outdatedUnits, missingTierUnits };
  }, [manifest, prefs.tiers, shardsByUnitId]);

  const eligibleCards = useMemo(() => {
    const cards: SrsCard[] = [];
    for (const shard of installedShards) {
      const targetTier = prefs.tiers[shard.language];
      if (!isTierIncluded(shard.tier, targetTier)) continue;
      cards.push(...shard.payload.srsCards);
    }
    return cards;
  }, [installedShards, prefs.tiers]);

  const eligibleStories = useMemo(() => {
    const stories: GradedStory[] = [];
    for (const shard of installedShards) {
      const targetTier = prefs.tiers[shard.language];
      if (!isTierIncluded(shard.tier, targetTier)) continue;
      stories.push(...shard.payload.gradedStories);
    }
    return stories;
  }, [installedShards, prefs.tiers]);

  const aggregatedReferenceSheets = useMemo(() => {
    const byId = new Map<string, ReferenceSheet>();
    for (const shard of installedShards) {
      const targetTier = prefs.tiers[shard.language];
      if (!isTierIncluded(shard.tier, targetTier)) continue;
      for (const sheet of shard.payload.referenceSheets) {
        const existing = byId.get(sheet.id);
        if (!existing) {
          byId.set(sheet.id, { ...sheet, rows: [...sheet.rows] });
        } else {
          const seenRows = new Set(existing.rows.map((r) => r.id));
          for (const row of sheet.rows) {
            if (!seenRows.has(row.id)) {
              existing.rows.push(row);
              seenRows.add(row.id);
            }
          }
        }
      }
    }
    return Array.from(byId.values());
  }, [installedShards, prefs.tiers]);

  const downloadUnit = useCallback(
    async (
      unitEntry: ManifestUnitEntry,
      language: LanguageCode,
      overrideTier?: UnderstandingTier
    ) => {
      const targetTier = overrideTier ?? prefs.tiers[language];
      setDownloadErrors((prev) => {
        const next = { ...prev };
        delete next[unitEntry.unitId];
        return next;
      });

      try {
        await downloadUnitDeltaShards({
          unitEntry,
          language,
          targetTier,
          customRepoOverride: prefs.customCurriculumRepo,
          onProgress: (prog) => {
            setDownloadProgress((prev) => ({
              ...prev,
              [unitEntry.unitId]: prog,
            }));
          },
        });
        await reloadLocalTables();
        notifyOfflineDbChanged();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Download interrupted. Check your connection and try again.";
        setDownloadErrors((prev) => ({
          ...prev,
          [unitEntry.unitId]: message,
        }));
        throw err;
      } finally {
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[unitEntry.unitId];
          return next;
        });
      }
    },
    [prefs.customCurriculumRepo, prefs.tiers, reloadLocalTables]
  );

  const removeUnit = useCallback(
    async (unitId: string) => {
      await removeUnitDownload(unitId);
      await reloadLocalTables();
      notifyOfflineDbChanged();
    },
    [reloadLocalTables]
  );

  const syncUnitUpdatesOrUpgrades = useCallback(
    async (items: Array<{ unit: ManifestUnitEntry; lang: LanguageCode }>) => {
      for (const { unit, lang } of items) {
        await downloadUnit(unit, lang);
      }
    },
    [downloadUnit]
  );

  const triggerWifiPrefetchAfterUnit = useCallback(
    async (language: LanguageCode, completedUnitNumber: number) => {
      if (!manifest) return;
      const fetched = await maybeAutoDownloadNextUnits({
        manifest,
        language,
        afterUnitNumber: completedUnitNumber,
        targetTier: prefs.tiers[language],
        autoDownloadWifi: prefs.autoDownloadWifi,
        customRepoOverride: prefs.customCurriculumRepo,
      });
      if (fetched.length > 0) {
        await reloadLocalTables();
        notifyOfflineDbChanged();
      }
    },
    [
      manifest,
      prefs.autoDownloadWifi,
      prefs.customCurriculumRepo,
      prefs.tiers,
      reloadLocalTables,
    ]
  );

  return {
    manifest,
    blueprint,
    isSyncingCatalog,
    catalogError,
    isOffline,
    refreshCatalog,
    installedMetas,
    installedShards,
    shardsByUnitId,
    metaByUnitId,
    completionByUnitId,
    storyCompletionById,
    reviewByCardId,
    todayActivity,
    totalStorageBytes,
    outdatedOrUpgradeUnits,
    eligibleCards,
    eligibleStories,
    aggregatedReferenceSheets,
    downloadProgress,
    downloadErrors,
    downloadUnit,
    removeUnit,
    syncUnitUpdatesOrUpgrades,
    triggerWifiPrefetchAfterUnit,
    reloadLocalTables,
  };
}

export type OfflineLibraryHandle = ReturnType<typeof useOfflineLibrary>;
