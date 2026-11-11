import type { CardReviewRecord } from "../db/offlineDb";
import type { LanguageCode, SrsCard } from "../schemas/curriculum";

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
        language: card.language,
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
    intervalDays = Math.max(prevInterval + 1, Math.round(prevInterval * multiplier));
  }

  return {
    record: {
      cardId: card.id,
      unitId: card.unitId,
      language: card.language,
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
  japaneseSplitPercent: number,
  nowMs = Date.now(),
  dailyNewLimit = 24,
  includeAhead = false
): SrsCard[] {
  const dueJa: SrsCard[] = [];
  const dueDe: SrsCard[] = [];
  const unseenJa: SrsCard[] = [];
  const unseenDe: SrsCard[] = [];
  const aheadJa: SrsCard[] = [];
  const aheadDe: SrsCard[] = [];

  for (const card of eligibleCards) {
    const rev = reviewMap.get(card.id);
    const isJa = card.language === "ja";
    if (!rev) {
      (isJa ? unseenJa : unseenDe).push(card);
    } else if (rev.dueAt <= nowMs) {
      (isJa ? dueJa : dueDe).push(card);
    } else if (includeAhead) {
      (isJa ? aheadJa : aheadDe).push(card);
    }
  }

  const sortByDue = (a: SrsCard, b: SrsCard) =>
    (reviewMap.get(a.id)?.dueAt ?? 0) - (reviewMap.get(b.id)?.dueAt ?? 0);

  dueJa.sort(sortByDue);
  dueDe.sort(sortByDue);
  aheadJa.sort(sortByDue);
  aheadDe.sort(sortByDue);

  const jaRatio = Math.min(1, Math.max(0, japaneseSplitPercent / 100));
  const targetNewJa = Math.round(dailyNewLimit * jaRatio);
  const targetNewDe = Math.max(
    japaneseSplitPercent < 100 && unseenDe.length > 0 ? 1 : 0,
    dailyNewLimit - targetNewJa
  );

  const poolJa = [
    ...dueJa,
    ...unseenJa.slice(0, targetNewJa),
    ...(includeAhead ? aheadJa.slice(0, 12) : []),
  ];
  const poolDe = [
    ...dueDe,
    ...unseenDe.slice(0, targetNewDe),
    ...(includeAhead ? aheadDe.slice(0, 8) : []),
  ];

  const queue: SrsCard[] = [];
  let jaCursor = 0;
  let deCursor = 0;
  let jaServed = 0;
  let totalServed = 0;

  while (jaCursor < poolJa.length || deCursor < poolDe.length) {
    const canServeJa = jaCursor < poolJa.length;
    const canServeDe = deCursor < poolDe.length;

    let pickLang: LanguageCode;
    if (canServeJa && canServeDe) {
      const currentRatio = totalServed === 0 ? 0 : jaServed / totalServed;
      pickLang = currentRatio <= jaRatio ? "ja" : "de";
    } else {
      pickLang = canServeJa ? "ja" : "de";
    }

    if (pickLang === "ja") {
      queue.push(poolJa[jaCursor]);
      jaCursor += 1;
      jaServed += 1;
    } else {
      queue.push(poolDe[deCursor]);
      deCursor += 1;
    }
    totalServed += 1;
  }

  return queue;
}
