import Dexie, { type Table } from "dexie";
import { BRAND } from "../config/brand";
import type {
  CourseBlueprint,
  CourseDescriptor,
  CourseId,
  Manifest,
  TierShard,
  UnderstandingTier,
  UnitMeta,
} from "../schemas/curriculum";

export interface StoredCourseDescriptor {
  courseId: CourseId;
  fetchedAt: number;
  descriptor: CourseDescriptor;
}

export interface StoredCourseBlueprint {
  courseId: CourseId;
  fetchedAt: number;
  blueprint: CourseBlueprint;
}

export interface StoredUnitMeta {
  unitId: string;
  courseId: CourseId;
  unitNumber: number;
  stageId: string;
  installedAt: number;
  meta: UnitMeta;
}

export interface StoredUnitShard {
  shardKey: string;
  unitId: string;
  courseId: CourseId;
  tier: UnderstandingTier;
  sha256: string;
  bytes: number;
  downloadedAt: number;
  payload: TierShard;
}

export interface CardReviewRecord {
  cardId: string;
  unitId: string;
  courseId: CourseId;
  tier: UnderstandingTier;
  repetitions: number;
  easinessFactor: number;
  intervalDays: number;
  dueAt: number;
  lastReviewedAt: number;
  lapses: number;
}

export interface LessonCompletionRecord {
  unitId: string;
  courseId: CourseId;
  completedAt: number;
  drillsCompleted: number;
  handsFreeCompleted: boolean;
}

export interface StoryCompletionRecord {
  storyId: string;
  unitId: string;
  courseId: CourseId;
  completedAt: number;
  score: number;
}

export interface DailyActivityRecord {
  dateKey: string;
  focusMinutes: number;
  completedSessionIndices: number[];
  checkedHomeworkIds: string[];
  reviewsCompleted: number;
}

export interface CachedCatalogIndex {
  id: "primary";
  fetchedAt: number;
  manifest: Manifest;
}

class LangOfflineDatabase extends Dexie {
  courseDescriptors!: Table<StoredCourseDescriptor, string>;
  courseBlueprints!: Table<StoredCourseBlueprint, string>;
  unitMeta!: Table<StoredUnitMeta, string>;
  unitShards!: Table<StoredUnitShard, string>;
  cardReviews!: Table<CardReviewRecord, string>;
  lessonCompletions!: Table<LessonCompletionRecord, string>;
  storyCompletions!: Table<StoryCompletionRecord, string>;
  dailyActivity!: Table<DailyActivityRecord, string>;
  cachedCatalog!: Table<CachedCatalogIndex, string>;

  constructor() {
    super(BRAND.dbName);

    this.version(1).stores({
      unitMeta: "&unitId, language, unitNumber, stageId",
      unitShards: "&shardKey, unitId, language, tier",
      cardReviews: "&cardId, unitId, language, tier, dueAt",
      lessonCompletions: "&unitId, language, completedAt",
      storyCompletions: "&storyId, unitId, language, completedAt",
      dailyActivity: "&dateKey",
      cachedCatalog: "&id",
    });

    this.version(2)
      .stores({
        courseDescriptors: "&courseId",
        courseBlueprints: "&courseId",
        unitMeta: "&unitId, courseId, unitNumber, stageId",
        unitShards: "&shardKey, unitId, courseId, tier",
        cardReviews: "&cardId, unitId, courseId, tier, dueAt",
        lessonCompletions: "&unitId, courseId, completedAt",
        storyCompletions: "&storyId, unitId, courseId, completedAt",
        dailyActivity: "&dateKey",
        cachedCatalog: "&id",
      })
      .upgrade(async (tx) => {
        await tx.table("cachedCatalog").clear();
        await tx.table("unitMeta").clear();
        await tx.table("unitShards").clear();

        await tx
          .table("cardReviews")
          .toCollection()
          .modify((record: Record<string, unknown>) => {
            if (!record.courseId && typeof record.language === "string") {
              record.courseId = record.language;
              delete record.language;
            }
          });

        await tx
          .table("lessonCompletions")
          .toCollection()
          .modify((record: Record<string, unknown>) => {
            if (!record.courseId && typeof record.language === "string") {
              record.courseId = record.language;
              delete record.language;
            }
          });

        await tx
          .table("storyCompletions")
          .toCollection()
          .modify((record: Record<string, unknown>) => {
            if (!record.courseId && typeof record.language === "string") {
              record.courseId = record.language;
              delete record.language;
            }
          });
      });
  }
}

export const offlineDb = new LangOfflineDatabase();

export function toLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function recordFocusMinutes(
  minutesToAdd: number,
  sessionIdx?: number
): Promise<void> {
  const dateKey = toLocalDateKey();
  const existing = await offlineDb.dailyActivity.get(dateKey);
  const completedSessionIndices = existing?.completedSessionIndices
    ? [...existing.completedSessionIndices]
    : [];

  if (
    sessionIdx !== undefined &&
    !completedSessionIndices.includes(sessionIdx)
  ) {
    completedSessionIndices.push(sessionIdx);
  }

  await offlineDb.dailyActivity.put({
    dateKey,
    focusMinutes: (existing?.focusMinutes ?? 0) + minutesToAdd,
    completedSessionIndices,
    checkedHomeworkIds: existing?.checkedHomeworkIds ?? [],
    reviewsCompleted: existing?.reviewsCompleted ?? 0,
  });
}

export async function toggleHomeworkCheck(
  homeworkId: string
): Promise<string[]> {
  const dateKey = toLocalDateKey();
  const existing = await offlineDb.dailyActivity.get(dateKey);
  const current = new Set(existing?.checkedHomeworkIds ?? []);
  if (current.has(homeworkId)) {
    current.delete(homeworkId);
  } else {
    current.add(homeworkId);
  }
  const updated = Array.from(current);

  await offlineDb.dailyActivity.put({
    dateKey,
    focusMinutes: existing?.focusMinutes ?? 0,
    completedSessionIndices: existing?.completedSessionIndices ?? [],
    checkedHomeworkIds: updated,
    reviewsCompleted: existing?.reviewsCompleted ?? 0,
  });

  return updated;
}

export async function incrementDailyReviewCount(): Promise<void> {
  const dateKey = toLocalDateKey();
  const existing = await offlineDb.dailyActivity.get(dateKey);
  await offlineDb.dailyActivity.put({
    dateKey,
    focusMinutes: existing?.focusMinutes ?? 0,
    completedSessionIndices: existing?.completedSessionIndices ?? [],
    checkedHomeworkIds: existing?.checkedHomeworkIds ?? [],
    reviewsCompleted: (existing?.reviewsCompleted ?? 0) + 1,
  });
}
