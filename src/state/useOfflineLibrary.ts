import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type CardReviewRecord,
  type DailyActivityRecord,
  type LessonCompletionRecord,
  offlineDb,
  type StoredCourseBlueprint,
  type StoredCourseDescriptor,
  type StoredUnitMeta,
  type StoredUnitShard,
  type StoryCompletionRecord,
  toLocalDateKey,
} from "../db/offlineDb";
import {
  type CourseBlueprint,
  type CourseDescriptor,
  type CourseId,
  type GradedStory,
  isTierIncluded,
  type Manifest,
  type ManifestCourseEntry,
  type ManifestUnitEntry,
  type ReferenceSheet,
  type SrsCard,
  TIER_ORDER,
  type UnderstandingTier,
} from "../schemas/curriculum";
import {
  computeUnitBytesForTier,
  descriptorFromManifestEntry,
  downloadUnitDeltaShards,
  fetchAndCacheCourseBlueprint,
  fetchAndCacheCourseDescriptor,
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
  const [isSyncingCatalog, setIsSyncingCatalog] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  const [storedDescriptors, setStoredDescriptors] = useState<
    StoredCourseDescriptor[]
  >([]);
  const [storedBlueprints, setStoredBlueprints] = useState<
    StoredCourseBlueprint[]
  >([]);
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
    const [
      descriptors,
      blueprints,
      metas,
      shards,
      reviews,
      lessons,
      stories,
      activity,
    ] = await Promise.all([
      offlineDb.courseDescriptors.toArray(),
      offlineDb.courseBlueprints.toArray(),
      offlineDb.unitMeta.toArray(),
      offlineDb.unitShards.toArray(),
      offlineDb.cardReviews.toArray(),
      offlineDb.lessonCompletions.toArray(),
      offlineDb.storyCompletions.toArray(),
      offlineDb.dailyActivity.get(todayKey),
    ]);

    setStoredDescriptors(descriptors);
    setStoredBlueprints(blueprints);
    setInstalledMetas(metas);
    setInstalledShards(shards);
    setCardReviews(reviews);
    setLessonCompletions(lessons);
    setStoryCompletions(stories);
    setTodayActivity(activity ?? null);
  }, []);

  const fetchCatalogAndApply = useCallback(async () => {
    const outcome = await syncCatalogIndex(prefs.repoConfig);
    if (outcome.manifest) {
      setManifest(outcome.manifest);
    }
    setCatalogError(
      outcome.error && !outcome.manifest ? outcome.error : null
    );
    setIsSyncingCatalog(false);
  }, [prefs.repoConfig]);

  const refreshCatalog = useCallback(async () => {
    setIsSyncingCatalog(true);
    setCatalogError(null);
    await fetchCatalogAndApply();
  }, [fetchCatalogAndApply]);

  useEffect(() => {
    let active = true;
    const todayKey = toLocalDateKey();
    void Promise.all([
      offlineDb.courseDescriptors.toArray(),
      offlineDb.courseBlueprints.toArray(),
      offlineDb.unitMeta.toArray(),
      offlineDb.unitShards.toArray(),
      offlineDb.cardReviews.toArray(),
      offlineDb.lessonCompletions.toArray(),
      offlineDb.storyCompletions.toArray(),
      offlineDb.dailyActivity.get(todayKey),
    ]).then(
      ([
        descriptors,
        blueprints,
        metas,
        shards,
        reviews,
        lessons,
        stories,
        activity,
      ]) => {
        if (!active) return;
        setStoredDescriptors(descriptors);
        setStoredBlueprints(blueprints);
        setInstalledMetas(metas);
        setInstalledShards(shards);
        setCardReviews(reviews);
        setLessonCompletions(lessons);
        setStoryCompletions(stories);
        setTodayActivity(activity ?? null);
      }
    );

    dbChangeListeners.add(reloadLocalTables);
    return () => {
      active = false;
      dbChangeListeners.delete(reloadLocalTables);
    };
  }, [reloadLocalTables]);

  useEffect(() => {
    let active = true;
    void syncCatalogIndex(prefs.repoConfig).then((outcome) => {
      if (!active) return;
      if (outcome.manifest) {
        setManifest(outcome.manifest);
      }
      setCatalogError(
        outcome.error && !outcome.manifest ? outcome.error : null
      );
      setIsSyncingCatalog(false);
    });
    return () => {
      active = false;
    };
  }, [prefs.repoConfig]);

  const enrolledIdsKey = useMemo(
    () => Object.keys(prefs.enrolledCourses).sort().join(","),
    [prefs.enrolledCourses]
  );

  useEffect(() => {
    if (!manifest || !enrolledIdsKey) return;
    let active = true;
    const enrolledIds = enrolledIdsKey.split(",").filter(Boolean);
    const tasks = enrolledIds.map(async (courseId) => {
      const entry = manifest.courses.find((c) => c.courseId === courseId);
      if (!entry) return;
      await Promise.all([
        fetchAndCacheCourseDescriptor(entry, prefs.repoConfig),
        fetchAndCacheCourseBlueprint(entry, prefs.repoConfig),
      ]);
    });

    void Promise.all(tasks).then(() => {
      if (!active) return;
      void reloadLocalTables();
    });

    return () => {
      active = false;
    };
  }, [manifest, enrolledIdsKey, prefs.repoConfig, reloadLocalTables]);

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

  const manifestCourseMap = useMemo(() => {
    const map = new Map<CourseId, ManifestCourseEntry>();
    if (manifest) {
      for (const entry of manifest.courses) {
        map.set(entry.courseId, entry);
      }
    }
    return map;
  }, [manifest]);

  const descriptorsByCourseId = useMemo(() => {
    const map = new Map<CourseId, CourseDescriptor>();
    if (manifest) {
      for (const entry of manifest.courses) {
        map.set(entry.courseId, descriptorFromManifestEntry(entry));
      }
    }
    for (const stored of storedDescriptors) {
      map.set(stored.courseId, stored.descriptor);
    }
    return map;
  }, [manifest, storedDescriptors]);

  const blueprintsByCourseId = useMemo(() => {
    const map = new Map<CourseId, CourseBlueprint>();
    for (const stored of storedBlueprints) {
      map.set(stored.courseId, stored.blueprint);
    }
    return map;
  }, [storedBlueprints]);

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
    const outdatedUnits: Array<{
      unit: ManifestUnitEntry;
      courseId: CourseId;
    }> = [];
    const missingTierByCourse: Record<
      CourseId,
      { units: ManifestUnitEntry[]; deltaBytes: number }
    > = {};

    if (!manifest) {
      return { outdatedUnits, missingTierByCourse };
    }

    for (const [courseId, enrollment] of Object.entries(
      prefs.enrolledCourses
    )) {
      const courseEntry = manifestCourseMap.get(courseId);
      if (!courseEntry) continue;

      missingTierByCourse[courseId] = { units: [], deltaBytes: 0 };

      for (const unit of courseEntry.units) {
        const localShards = shardsByUnitId.get(unit.unitId) ?? [];
        if (localShards.length === 0) continue;

        const summary = summarizeInstalledUnit(
          unit,
          enrollment.tier,
          localShards
        );
        if (summary.outdatedTiers.length > 0) {
          outdatedUnits.push({ unit, courseId });
        }
        if (summary.missingTiersForGoal.length > 0) {
          const { deltaBytesToFetch } = computeUnitBytesForTier(
            unit,
            enrollment.tier,
            localShards
          );
          missingTierByCourse[courseId].units.push(unit);
          missingTierByCourse[courseId].deltaBytes += deltaBytesToFetch;
        }
      }
    }

    return { outdatedUnits, missingTierByCourse };
  }, [manifest, manifestCourseMap, prefs.enrolledCourses, shardsByUnitId]);

  const eligibleCards = useMemo(() => {
    const cards: SrsCard[] = [];
    for (const shard of installedShards) {
      const enrollment = prefs.enrolledCourses[shard.courseId];
      if (!enrollment || enrollment.status !== "active") continue;
      if (!isTierIncluded(shard.tier, enrollment.tier)) continue;
      cards.push(...shard.payload.srsCards);
    }
    return cards;
  }, [installedShards, prefs.enrolledCourses]);

  const eligibleStories = useMemo(() => {
    const stories: GradedStory[] = [];
    for (const shard of installedShards) {
      const enrollment = prefs.enrolledCourses[shard.courseId];
      if (!enrollment || enrollment.status !== "active") continue;
      if (!isTierIncluded(shard.tier, enrollment.tier)) continue;
      stories.push(...shard.payload.gradedStories);
    }
    return stories;
  }, [installedShards, prefs.enrolledCourses]);

  const aggregatedReferenceSheets = useMemo(() => {
    const byKey = new Map<string, ReferenceSheet>();
    for (const shard of installedShards) {
      const enrollment = prefs.enrolledCourses[shard.courseId];
      if (!enrollment || enrollment.status !== "active") continue;
      if (!isTierIncluded(shard.tier, enrollment.tier)) continue;
      for (const sheet of shard.payload.referenceSheets) {
        const compositeKey = `${shard.courseId}:${sheet.id}`;
        const existing = byKey.get(compositeKey);
        if (!existing) {
          byKey.set(compositeKey, { ...sheet, rows: [...sheet.rows] });
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
    return Array.from(byKey.values());
  }, [installedShards, prefs.enrolledCourses]);

  const downloadUnit = useCallback(
    async (
      unitEntry: ManifestUnitEntry,
      courseId: CourseId,
      overrideTier?: UnderstandingTier
    ) => {
      const enrollment = prefs.enrolledCourses[courseId];
      const targetTier = overrideTier ?? enrollment?.tier ?? "conversational";
      const courseEntry = manifestCourseMap.get(courseId);

      setDownloadErrors((prev) => {
        const next = { ...prev };
        delete next[unitEntry.unitId];
        return next;
      });

      try {
        await downloadUnitDeltaShards({
          unitEntry,
          courseId,
          courseEntry,
          targetTier,
          repoConfig: prefs.repoConfig,
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
    [manifestCourseMap, prefs.enrolledCourses, prefs.repoConfig, reloadLocalTables]
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
    async (items: Array<{ unit: ManifestUnitEntry; courseId: CourseId }>) => {
      for (const { unit, courseId } of items) {
        await downloadUnit(unit, courseId);
      }
    },
    [downloadUnit]
  );

  const triggerWifiPrefetchAfterUnit = useCallback(
    async (courseId: CourseId, completedUnitNumber: number) => {
      if (!manifest) return;
      const enrollment = prefs.enrolledCourses[courseId];
      if (!enrollment) return;
      const fetched = await maybeAutoDownloadNextUnits({
        manifest,
        courseId,
        afterUnitNumber: completedUnitNumber,
        targetTier: enrollment.tier,
        autoDownloadWifi: prefs.autoDownloadWifi,
        repoConfig: prefs.repoConfig,
      });
      if (fetched.length > 0) {
        await reloadLocalTables();
        notifyOfflineDbChanged();
      }
    },
    [
      manifest,
      prefs.autoDownloadWifi,
      prefs.enrolledCourses,
      prefs.repoConfig,
      reloadLocalTables,
    ]
  );

  const ensureCourseAssets = useCallback(
    async (courseId: CourseId) => {
      const entry = manifestCourseMap.get(courseId);
      if (!entry) return;
      await Promise.all([
        fetchAndCacheCourseDescriptor(entry, prefs.repoConfig),
        fetchAndCacheCourseBlueprint(entry, prefs.repoConfig),
      ]);
      await reloadLocalTables();
    },
    [manifestCourseMap, prefs.repoConfig, reloadLocalTables]
  );

  return {
    manifest,
    manifestCourseMap,
    descriptorsByCourseId,
    blueprintsByCourseId,
    isSyncingCatalog,
    catalogError,
    isOffline,
    refreshCatalog,
    ensureCourseAssets,
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
