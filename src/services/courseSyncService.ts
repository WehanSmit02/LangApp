import { offlineDb, type StoredUnitShard } from "../db/offlineDb";
import {
  type CourseBlueprint,
  CourseBlueprintSchema,
  type CourseDescriptor,
  CourseDescriptorSchema,
  type CourseId,
  type Manifest,
  type ManifestCourseEntry,
  ManifestSchema,
  type ManifestUnitEntry,
  TierShardSchema,
  tiersUpTo,
  type UnderstandingTier,
  UnitMetaSchema,
} from "../schemas/curriculum";
import {
  type CurriculumRepoConfig,
  fetchCurriculumJson,
} from "./githubRepoSync";

export interface UnitDownloadProgress {
  unitId: string;
  loadedBytes: number;
  totalBytes: number;
  activeShardLabel: string;
}

export interface UnitInstallSummary {
  unitId: string;
  installedTiers: UnderstandingTier[];
  installedBytes: number;
  missingTiersForGoal: UnderstandingTier[];
  outdatedTiers: UnderstandingTier[];
  isReadyForGoal: boolean;
}

export async function syncCatalogIndex(
  repoConfig: CurriculumRepoConfig
): Promise<{
  manifest: Manifest | null;
  fromCache: boolean;
  error?: string;
}> {
  const cached = await offlineDb.cachedCatalog.get("primary");

  if (typeof navigator !== "undefined" && !navigator.onLine && cached) {
    return {
      manifest: cached.manifest,
      fromCache: true,
    };
  }

  try {
    const rawManifest = await fetchCurriculumJson<unknown>(
      "manifest.json",
      repoConfig,
      { cacheBustMinute: true }
    );
    const manifest = ManifestSchema.parse(rawManifest);

    await offlineDb.cachedCatalog.put({
      id: "primary",
      fetchedAt: Date.now(),
      manifest,
    });

    return {
      manifest,
      fromCache: false,
    };
  } catch (err) {
    if (cached) {
      return {
        manifest: cached.manifest,
        fromCache: true,
        error: err instanceof Error ? err.message : "Offline mode active",
      };
    }
    return {
      manifest: null,
      fromCache: false,
      error:
        err instanceof Error
          ? err.message
          : "Unable to reach course repository.",
    };
  }
}

export function descriptorFromManifestEntry(
  entry: ManifestCourseEntry
): CourseDescriptor {
  const { hasScriptGrids: _ignored, ...rest } = entry.descriptor;
  return rest;
}

export async function fetchAndCacheCourseDescriptor(
  entry: ManifestCourseEntry,
  repoConfig: CurriculumRepoConfig
): Promise<CourseDescriptor> {
  const cached = await offlineDb.courseDescriptors.get(entry.courseId);
  if (typeof navigator !== "undefined" && !navigator.onLine && cached) {
    return cached.descriptor;
  }

  try {
    const raw = await fetchCurriculumJson<unknown>(
      entry.courseDescriptorPath,
      repoConfig,
      { cacheBustMinute: true }
    );
    const descriptor = CourseDescriptorSchema.parse(raw);
    await offlineDb.courseDescriptors.put({
      courseId: entry.courseId,
      fetchedAt: Date.now(),
      descriptor,
    });
    return descriptor;
  } catch {
    if (cached) {
      return cached.descriptor;
    }
    return descriptorFromManifestEntry(entry);
  }
}

export async function fetchAndCacheCourseBlueprint(
  entry: ManifestCourseEntry,
  repoConfig: CurriculumRepoConfig
): Promise<CourseBlueprint | null> {
  const cached = await offlineDb.courseBlueprints.get(entry.courseId);
  if (typeof navigator !== "undefined" && !navigator.onLine && cached) {
    return cached.blueprint;
  }

  try {
    const raw = await fetchCurriculumJson<unknown>(
      entry.blueprintPath,
      repoConfig,
      { cacheBustMinute: true }
    );
    const blueprint = CourseBlueprintSchema.parse(raw);
    await offlineDb.courseBlueprints.put({
      courseId: entry.courseId,
      fetchedAt: Date.now(),
      blueprint,
    });
    return blueprint;
  } catch {
    return cached?.blueprint ?? null;
  }
}

export function computeUnitBytesForTier(
  unitEntry: ManifestUnitEntry,
  targetTier: UnderstandingTier,
  existingShards: StoredUnitShard[] = []
): { totalTargetBytes: number; deltaBytesToFetch: number } {
  const required = tiersUpTo(targetTier);
  const cachedByTier = new Map(existingShards.map((s) => [s.tier, s]));

  let totalTargetBytes = 0;
  let deltaBytesToFetch = 0;

  for (const tier of required) {
    const descriptor = unitEntry.shards[tier];
    if (!descriptor) continue;
    totalTargetBytes += descriptor.bytes;
    const cached = cachedByTier.get(tier);
    if (!cached || cached.sha256 !== descriptor.sha256) {
      deltaBytesToFetch += descriptor.bytes;
    }
  }

  return { totalTargetBytes, deltaBytesToFetch };
}

export function summarizeInstalledUnit(
  unitEntry: ManifestUnitEntry,
  targetTier: UnderstandingTier,
  unitShards: StoredUnitShard[]
): UnitInstallSummary {
  const required = tiersUpTo(targetTier);
  const byTier = new Map(unitShards.map((s) => [s.tier, s]));

  const installedTiers = unitShards.map((s) => s.tier);
  const installedBytes = unitShards.reduce((sum, s) => sum + s.bytes, 0);
  const missingTiersForGoal: UnderstandingTier[] = [];
  const outdatedTiers: UnderstandingTier[] = [];

  for (const tier of required) {
    const remote = unitEntry.shards[tier];
    if (!remote) continue;
    const local = byTier.get(tier);
    if (!local) {
      missingTiersForGoal.push(tier);
    } else if (local.sha256 !== remote.sha256) {
      outdatedTiers.push(tier);
    }
  }

  const isReadyForGoal =
    installedTiers.length > 0 && missingTiersForGoal.length === 0;

  return {
    unitId: unitEntry.unitId,
    installedTiers,
    installedBytes,
    missingTiersForGoal,
    outdatedTiers,
    isReadyForGoal,
  };
}

export async function downloadUnitDeltaShards(options: {
  unitEntry: ManifestUnitEntry;
  courseId: CourseId;
  courseEntry?: ManifestCourseEntry;
  targetTier: UnderstandingTier;
  repoConfig: CurriculumRepoConfig;
  onProgress?: (progress: UnitDownloadProgress) => void;
}): Promise<void> {
  const {
    unitEntry,
    courseId,
    courseEntry,
    targetTier,
    repoConfig,
    onProgress,
  } = options;

  const requiredTiers = tiersUpTo(targetTier);
  const existingShards = await offlineDb.unitShards
    .where("unitId")
    .equals(unitEntry.unitId)
    .toArray();
  const existingByTier = new Map(existingShards.map((s) => [s.tier, s]));

  const tiersToDownload = requiredTiers.filter((tier) => {
    const remote = unitEntry.shards[tier];
    if (!remote) return false;
    const cached = existingByTier.get(tier);
    return !cached || cached.sha256 !== remote.sha256;
  });

  const existingMeta = await offlineDb.unitMeta.get(unitEntry.unitId);
  const existingDescriptor = await offlineDb.courseDescriptors.get(courseId);

  const totalBytes =
    tiersToDownload.reduce(
      (sum, t) => sum + (unitEntry.shards[t]?.bytes ?? 0),
      0
    ) +
    (existingMeta ? 0 : 900) +
    (!existingDescriptor && courseEntry ? 1200 : 0);

  let loadedBytes = 0;

  const report = (label: string, delta = 0) => {
    loadedBytes = Math.min(totalBytes, loadedBytes + delta);
    onProgress?.({
      unitId: unitEntry.unitId,
      loadedBytes,
      totalBytes: Math.max(1, totalBytes),
      activeShardLabel: label,
    });
  };

  report("Preparing unit", 0);

  if (!existingDescriptor && courseEntry) {
    await fetchAndCacheCourseDescriptor(courseEntry, repoConfig);
    report("Course soundboard & settings", 1200);
  }

  if (!existingMeta) {
    const rawMeta = await fetchCurriculumJson<unknown>(
      `${unitEntry.directory}/meta.json`,
      repoConfig,
      {
        expectedBytes: 900,
        cacheBustMinute: true,
        onChunkBytes: (delta) => report("Unit overview", delta),
      }
    );
    const meta = UnitMetaSchema.parse(rawMeta);
    await offlineDb.unitMeta.put({
      unitId: meta.unitId,
      courseId,
      unitNumber: meta.unitNumber,
      stageId: meta.stageId,
      installedAt: Date.now(),
      meta,
    });
  }

  for (const tier of tiersToDownload) {
    const descriptor = unitEntry.shards[tier];
    if (!descriptor) continue;

    const rawShard = await fetchCurriculumJson<unknown>(
      `${unitEntry.directory}/${descriptor.file}`,
      repoConfig,
      {
        expectedBytes: descriptor.bytes,
        sha256: descriptor.sha256,
        onChunkBytes: (delta) => report(descriptor.file, delta),
      }
    );
    const parsedShard = TierShardSchema.parse(rawShard);

    await offlineDb.unitShards.put({
      shardKey: `${unitEntry.unitId}:${tier}`,
      unitId: unitEntry.unitId,
      courseId,
      tier,
      sha256: descriptor.sha256,
      bytes: descriptor.bytes,
      downloadedAt: Date.now(),
      payload: parsedShard,
    });
  }

  onProgress?.({
    unitId: unitEntry.unitId,
    loadedBytes: Math.max(1, totalBytes),
    totalBytes: Math.max(1, totalBytes),
    activeShardLabel: "Ready offline",
  });
}

export async function removeUnitDownload(unitId: string): Promise<void> {
  await offlineDb.transaction(
    "rw",
    offlineDb.unitShards,
    offlineDb.unitMeta,
    async () => {
      await offlineDb.unitShards.where("unitId").equals(unitId).delete();
      await offlineDb.unitMeta.delete(unitId);
    }
  );
}

export function isWifiLikeConnection(): boolean {
  if (typeof navigator === "undefined" || !navigator.onLine) return false;
  const conn = (
    navigator as unknown as {
      connection?: { saveData?: boolean; type?: string };
    }
  ).connection;
  if (!conn) return true;
  if (conn.saveData) return false;
  if (conn.type && ["cellular", "bluetooth", "none"].includes(conn.type)) {
    return false;
  }
  return true;
}

export async function maybeAutoDownloadNextUnits(options: {
  manifest: Manifest;
  courseId: CourseId;
  afterUnitNumber: number;
  targetTier: UnderstandingTier;
  autoDownloadWifi: boolean;
  repoConfig: CurriculumRepoConfig;
}): Promise<string[]> {
  const {
    manifest,
    courseId,
    afterUnitNumber,
    targetTier,
    autoDownloadWifi,
    repoConfig,
  } = options;

  if (!autoDownloadWifi || !isWifiLikeConnection()) {
    return [];
  }

  const courseEntry = manifest.courses.find((c) => c.courseId === courseId);
  if (!courseEntry) {
    return [];
  }

  const allShards = await offlineDb.unitShards
    .where("courseId")
    .equals(courseId)
    .toArray();
  const byUnit = new Map<string, StoredUnitShard[]>();
  for (const s of allShards) {
    const arr = byUnit.get(s.unitId) ?? [];
    arr.push(s);
    byUnit.set(s.unitId, arr);
  }

  const candidates = courseEntry.units
    .filter((u) => u.unitNumber > afterUnitNumber)
    .sort((a, b) => a.unitNumber - b.unitNumber)
    .slice(0, 2);

  const downloadedIds: string[] = [];
  for (const unit of candidates) {
    const summary = summarizeInstalledUnit(
      unit,
      targetTier,
      byUnit.get(unit.unitId) ?? []
    );
    if (!summary.isReadyForGoal) {
      try {
        await downloadUnitDeltaShards({
          unitEntry: unit,
          courseId,
          courseEntry,
          targetTier,
          repoConfig,
        });
        downloadedIds.push(unit.unitId);
      } catch {
        // Background prefetch failures remain silent
      }
    }
  }

  return downloadedIds;
}
