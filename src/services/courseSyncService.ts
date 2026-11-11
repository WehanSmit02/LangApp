import { resolveCurriculumBaseUrl } from "../config/brand";
import { offlineDb, type StoredUnitShard } from "../db/offlineDb";
import {
  type LanguageCode,
  type Manifest,
  ManifestSchema,
  type ManifestUnitEntry,
  type SyllabusBlueprint,
  SyllabusBlueprintSchema,
  TierShardSchema,
  tiersUpTo,
  type UnderstandingTier,
  UnitMetaSchema,
} from "../schemas/curriculum";

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

function getBaseUrl(customOverride?: string): string {
  const runtimeBase = import.meta.env.BASE_URL || "/";
  return resolveCurriculumBaseUrl(customOverride, runtimeBase);
}

async function fetchJsonWithProgress<T>(
  url: string,
  expectedBytes: number,
  onChunkBytes?: (deltaBytes: number) => void
): Promise<T> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }

  if (!response.body || !onChunkBytes) {
    const text = await response.text();
    onChunkBytes?.(expectedBytes || text.length);
    return JSON.parse(text) as T;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let reportedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      reportedBytes += value.byteLength;
      onChunkBytes(value.byteLength);
    }
  }

  if (expectedBytes > reportedBytes) {
    onChunkBytes(expectedBytes - reportedBytes);
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const decoded = new TextDecoder("utf-8").decode(merged);
  return JSON.parse(decoded) as T;
}

export async function syncCatalogIndex(customRepoOverride?: string): Promise<{
  manifest: Manifest | null;
  blueprint: SyllabusBlueprint | null;
  fromCache: boolean;
  error?: string;
}> {
  const baseUrl = getBaseUrl(customRepoOverride);
  const cached = await offlineDb.cachedCatalog.get("primary");

  if (typeof navigator !== "undefined" && !navigator.onLine && cached) {
    return {
      manifest: cached.manifest,
      blueprint: cached.blueprint ?? null,
      fromCache: true,
    };
  }

  try {
    const [manifestRes, blueprintRes] = await Promise.all([
      fetch(`${baseUrl}/manifest.json`, { cache: "no-cache" }),
      fetch(`${baseUrl}/syllabus-blueprint.json`, { cache: "no-cache" }).catch(
        () => null
      ),
    ]);

    if (!manifestRes.ok) {
      throw new Error(`Manifest returned status ${manifestRes.status}`);
    }

    const rawManifest = await manifestRes.json();
    const manifest = ManifestSchema.parse(rawManifest);

    let blueprint: SyllabusBlueprint | undefined = cached?.blueprint;
    if (blueprintRes && blueprintRes.ok) {
      const rawBp = await blueprintRes.json();
      blueprint = SyllabusBlueprintSchema.parse(rawBp);
    }

    await offlineDb.cachedCatalog.put({
      id: "primary",
      fetchedAt: Date.now(),
      manifest,
      blueprint,
    });

    return {
      manifest,
      blueprint: blueprint ?? null,
      fromCache: false,
    };
  } catch (err) {
    if (cached) {
      return {
        manifest: cached.manifest,
        blueprint: cached.blueprint ?? null,
        fromCache: true,
        error: err instanceof Error ? err.message : "Offline mode active",
      };
    }
    return {
      manifest: null,
      blueprint: null,
      fromCache: false,
      error:
        err instanceof Error
          ? err.message
          : "Unable to reach curriculum server.",
    };
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
    installedTiers.length > 0 &&
    missingTiersForGoal.length === 0;

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
  language: LanguageCode;
  targetTier: UnderstandingTier;
  customRepoOverride?: string;
  onProgress?: (progress: UnitDownloadProgress) => void;
}): Promise<void> {
  const {
    unitEntry,
    language,
    targetTier,
    customRepoOverride,
    onProgress,
  } = options;

  const baseUrl = getBaseUrl(customRepoOverride);
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
  const totalBytes =
    tiersToDownload.reduce(
      (sum, t) => sum + (unitEntry.shards[t]?.bytes ?? 0),
      0
    ) + (existingMeta ? 0 : 900);

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

  if (!existingMeta) {
    const rawMeta = await fetchJsonWithProgress<unknown>(
      `${baseUrl}/${unitEntry.directory}/meta.json`,
      900,
      (delta) => report("Unit overview", delta)
    );
    const meta = UnitMetaSchema.parse(rawMeta);
    await offlineDb.unitMeta.put({
      unitId: meta.unitId,
      language,
      unitNumber: meta.unitNumber,
      stageId: meta.stageId,
      installedAt: Date.now(),
      meta,
    });
  }

  for (const tier of tiersToDownload) {
    const descriptor = unitEntry.shards[tier];
    if (!descriptor) continue;

    const rawShard = await fetchJsonWithProgress<unknown>(
      `${baseUrl}/${unitEntry.directory}/${descriptor.file}`,
      descriptor.bytes,
      (delta) => report(descriptor.file, delta)
    );
    const parsedShard = TierShardSchema.parse(rawShard);

    await offlineDb.unitShards.put({
      shardKey: `${unitEntry.unitId}:${tier}`,
      unitId: unitEntry.unitId,
      language,
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
  language: LanguageCode;
  afterUnitNumber: number;
  targetTier: UnderstandingTier;
  autoDownloadWifi: boolean;
  customRepoOverride?: string;
}): Promise<string[]> {
  const {
    manifest,
    language,
    afterUnitNumber,
    targetTier,
    autoDownloadWifi,
    customRepoOverride,
  } = options;

  if (!autoDownloadWifi || !isWifiLikeConnection()) {
    return [];
  }

  const allShards = await offlineDb.unitShards
    .where("language")
    .equals(language)
    .toArray();
  const byUnit = new Map<string, StoredUnitShard[]>();
  for (const s of allShards) {
    const arr = byUnit.get(s.unitId) ?? [];
    arr.push(s);
    byUnit.set(s.unitId, arr);
  }

  const candidates = manifest.languages[language].units
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
          language,
          targetTier,
          customRepoOverride,
        });
        downloadedIds.push(unit.unitId);
      } catch {
        // Background prefetch failures remain silent
      }
    }
  }

  return downloadedIds;
}
