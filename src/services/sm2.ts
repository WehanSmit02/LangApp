import type { CardReviewRecord } from "../db/offlineDb";
import type { CourseId, SrsCard } from "../schemas/curriculum";

export type ReviewGrade = "again" | "hard" | "good" | "easy";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface ScheduledReviewUpdate {
  record: CardReviewRecord;
  intervalLabel: string;
}

export function computeSm2Update(
  card: SrsCard,
  existing: CardReviewRecord | undefined,
  grade: ReviewGrade,
  nowMs = Date.now()
): ScheduledReviewUpdate {
  const prevReps = existing?.repetitions ?? 0;
  const prevEf = existing?.easinessFactor ?? 2.5;
  const prevInterval = existing?.intervalDays ?? 0;
  const prevLapses = existing?.lapses ?? 0;

  if (grade === "again") {
    const nextEf = Math.max(1.3, prevEf - 0.2);
    return {
      record: {
        cardId: card.id,
        unitId: card.unitId,
        courseId: card.courseId,
        tier: card.tier,
        repetitions: 0,
        easinessFactor: Number(nextEf.toFixed(2)),
        intervalDays: 0,
        dueAt: nowMs + 10 * MINUTE_MS,
        lastReviewedAt: nowMs,
        lapses: prevLapses + 1,
      },
      intervalLabel: "10m",
    };
  }

  const qualityMap: Record<Exclude<ReviewGrade, "again">, number> = {
    hard: 3,
    good: 4,
    easy: 5,
  };
  const q = qualityMap[grade];
  const rawEf = prevEf + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  const nextEf = Math.max(1.3, Number(rawEf.toFixed(2)));

  let intervalDays: number;
  if (prevReps === 0) {
    intervalDays = grade === "hard" ? 1 : grade === "good" ? 1 : 4;
  } else if (prevReps === 1) {
    intervalDays = grade === "hard" ? 2 : grade === "good" ? 6 : 8;
  } else {
    const multiplier =
      grade === "hard" ? 1.2 : grade === "good" ? nextEf : nextEf * 1.3;
    intervalDays = Math.max(
      prevInterval + 1,
      Math.round(prevInterval * multiplier)
    );
  }

  return {
    record: {
      cardId: card.id,
      unitId: card.unitId,
      courseId: card.courseId,
      tier: card.tier,
      repetitions: prevReps + 1,
      easinessFactor: nextEf,
      intervalDays,
      dueAt: nowMs + intervalDays * DAY_MS,
      lastReviewedAt: nowMs,
      lapses: prevLapses,
    },
    intervalLabel: formatIntervalLabel(intervalDays),
  };
}

export function formatIntervalLabel(intervalDays: number): string {
  if (intervalDays <= 0) return "10m";
  if (intervalDays < 30) return `${intervalDays}d`;
  if (intervalDays < 365) {
    const months = (intervalDays / 30).toFixed(intervalDays >= 90 ? 0 : 1);
    return `${months.replace(/\.0$/, "")}mo`;
  }
  const years = (intervalDays / 365).toFixed(1);
  return `${years.replace(/\.0$/, "")}y`;
}

export function previewCardIntervals(
  card: SrsCard,
  existing: CardReviewRecord | undefined,
  nowMs = Date.now()
): Record<ReviewGrade, string> {
  return {
    again: computeSm2Update(card, existing, "again", nowMs).intervalLabel,
    hard: computeSm2Update(card, existing, "hard", nowMs).intervalLabel,
    good: computeSm2Update(card, existing, "good", nowMs).intervalLabel,
    easy: computeSm2Update(card, existing, "easy", nowMs).intervalLabel,
  };
}

export function buildWeightedReviewQueue(
  eligibleCards: SrsCard[],
  reviewMap: Map<string, CardReviewRecord>,
  courseWeights: Record<CourseId, number>,
  nowMs = Date.now(),
  dailyNewLimit = 24,
  includeAhead = false
): SrsCard[] {
  const buckets = new Map<
    CourseId,
    { due: SrsCard[]; unseen: SrsCard[]; ahead: SrsCard[] }
  >();

  for (const card of eligibleCards) {
    let bucket = buckets.get(card.courseId);
    if (!bucket) {
      bucket = { due: [], unseen: [], ahead: [] };
      buckets.set(card.courseId, bucket);
    }
    const rev = reviewMap.get(card.id);
    if (!rev) {
      bucket.unseen.push(card);
    } else if (rev.dueAt <= nowMs) {
      bucket.due.push(card);
    } else if (includeAhead) {
      bucket.ahead.push(card);
    }
  }

  if (buckets.size === 0) {
    return [];
  }

  const sortByDue = (a: SrsCard, b: SrsCard) =>
    (reviewMap.get(a.id)?.dueAt ?? 0) - (reviewMap.get(b.id)?.dueAt ?? 0);

  const courseIds = Array.from(buckets.keys());
  const rawWeightSum = courseIds.reduce(
    (sum, id) => sum + Math.max(0, courseWeights[id] ?? 0),
    0
  );

  const pools = courseIds.map((courseId) => {
    const bucket = buckets.get(courseId)!;
    bucket.due.sort(sortByDue);
    bucket.ahead.sort(sortByDue);

    const ratio =
      rawWeightSum > 0
        ? Math.max(0, courseWeights[courseId] ?? 0) / rawWeightSum
        : 1 / courseIds.length;

    const targetNew =
      ratio > 0 && bucket.unseen.length > 0
        ? Math.max(1, Math.round(dailyNewLimit * ratio))
        : 0;
    const aheadCap = Math.max(4, Math.round(16 * ratio));

    const cards = [
      ...bucket.due,
      ...bucket.unseen.slice(0, targetNew),
      ...(includeAhead ? bucket.ahead.slice(0, aheadCap) : []),
    ];

    return {
      courseId,
      ratio: ratio > 0 ? ratio : 0.01,
      cards,
      cursor: 0,
      served: 0,
    };
  });

  const queue: SrsCard[] = [];
  let totalServed = 0;

  while (pools.some((p) => p.cursor < p.cards.length)) {
    let chosen = pools.find((p) => p.cursor < p.cards.length)!;
    let largestDeficit = -Infinity;

    for (const pool of pools) {
      if (pool.cursor >= pool.cards.length) continue;
      const actualShare = totalServed === 0 ? 0 : pool.served / totalServed;
      const deficit = pool.ratio - actualShare;
      if (deficit > largestDeficit) {
        largestDeficit = deficit;
        chosen = pool;
      }
    }

    queue.push(chosen.cards[chosen.cursor]);
    chosen.cursor += 1;
    chosen.served += 1;
    totalServed += 1;
  }

  return queue;
}
