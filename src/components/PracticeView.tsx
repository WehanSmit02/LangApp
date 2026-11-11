import {
  ArrowUpRight,
  CheckCircle2,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { incrementDailyReviewCount, offlineDb } from "../db/offlineDb";
import { type SrsCard, TIER_META } from "../schemas/curriculum";
import {
  buildWeightedReviewQueue,
  computeSm2Update,
  previewCardIntervals,
  type ReviewGrade,
} from "../services/sm2";
import { speakText } from "../services/speechService";
import type { UserPreferences } from "../state/preferences";
import {
  notifyOfflineDbChanged,
  type OfflineLibraryHandle,
} from "../state/useOfflineLibrary";
import {
  CARD_REVEAL_TRANSITION,
  resolveTransition,
} from "../utils/motionPresets";
import { CompoundWordText, RubyText } from "./ui/RubyText";
import { SegmentedControl } from "./ui/SegmentedControl";

type PracticeFilter = "all" | "ja" | "de";

export function PracticeView({
  prefs,
  library,
  onNavigateCourses,
}: {
  prefs: UserPreferences;
  library: OfflineLibraryHandle;
  onNavigateCourses: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const revealTransition = resolveTransition(
    prefersReducedMotion,
    CARD_REVEAL_TRANSITION
  );

  const [filter, setFilter] = useState<PracticeFilter>("all");
  const [studyAhead, setStudyAhead] = useState<boolean>(false);
  const [revealedCardId, setRevealedCardId] = useState<string | null>(null);
  const [sessionReviewed, setSessionReviewed] = useState<number>(0);
  const [queueClockMs, setQueueClockMs] = useState<number>(() => Date.now());

  const filteredCards = useMemo(() => {
    if (filter === "all") return library.eligibleCards;
    return library.eligibleCards.filter((c) => c.language === filter);
  }, [library.eligibleCards, filter]);

  const queue = useMemo(() => {
    const split =
      filter === "ja" ? 100 : filter === "de" ? 0 : prefs.japaneseSplitPercent;
    return buildWeightedReviewQueue(
      filteredCards,
      library.reviewByCardId,
      split,
      queueClockMs,
      24,
      studyAhead
    );
  }, [
    filteredCards,
    library.reviewByCardId,
    filter,
    prefs.japaneseSplitPercent,
    queueClockMs,
    studyAhead,
  ]);

  const currentCard: SrsCard | undefined = queue[0];
  const revealed =
    currentCard !== undefined && revealedCardId === currentCard.id;

  const resolveCardTarget = (card: SrsCard): string => {
    if (
      card.language === "de" &&
      !prefs.austrianMode &&
      card.standardGermanText
    ) {
      return card.standardGermanText;
    }
    return card.targetText;
  };

  const handleGrade = async (grade: ReviewGrade) => {
    if (!currentCard) return;
    const now = Date.now();
    const existing = library.reviewByCardId.get(currentCard.id);
    const { record } = computeSm2Update(currentCard, existing, grade, now);

    await offlineDb.cardReviews.put(record);
    await incrementDailyReviewCount();
    setSessionReviewed((c) => c + 1);
    setRevealedCardId(null);
    setQueueClockMs(Date.now());
    notifyOfflineDbChanged();
  };

  const intervals = useMemo(() => {
    if (!currentCard) return null;
    return previewCardIntervals(
      currentCard,
      library.reviewByCardId.get(currentCard.id),
      queueClockMs
    );
  }, [currentCard, library.reviewByCardId, queueClockMs]);

  if (library.eligibleCards.length === 0) {
    return (
      <div className="space-y-4">
        <section className="hig-card p-4 sm:p-5">
          <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
            Practice
          </h1>
          <p className="mt-1 text-[14px] text-[var(--ink-secondary)]">
            Spaced-repetition flashcards drawn from your downloaded units.
          </p>
        </section>

        <section className="hig-card p-6 text-center space-y-4">
          <h2 className="text-[18px] font-semibold text-[var(--ink-primary)]">
            No flashcards downloaded yet
          </h2>
          <p className="mx-auto max-w-md text-[14px] leading-relaxed text-[var(--ink-secondary)]">
            Choose your goal level and download Unit 1 in Courses to populate your offline review queue.
          </p>
          <motion.button
            id="practice-empty-courses-cta"
            type="button"
            whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
            onClick={onNavigateCourses}
            className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-white"
          >
            <span>Browse Courses</span>
            <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
          </motion.button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="hig-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
              Practice
            </h1>
            <p className="mt-1 text-[14px] text-[var(--ink-secondary)] tabular-nums">
              {queue.length} remaining in queue · {sessionReviewed} reviewed this session
            </p>
          </div>
          <span className="rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[12px] font-medium text-[var(--ink-secondary)] tabular-nums">
            {prefs.japaneseSplitPercent}% JP /{" "}
            {Number((100 - prefs.japaneseSplitPercent).toFixed(1))}% DE
          </span>
        </div>

        <SegmentedControl<PracticeFilter>
          id="practice-lang-filter"
          ariaLabel="Filter flashcards by language"
          compact
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setStudyAhead(false);
          }}
          options={[
            { value: "all", label: "Weighted Mix" },
            { value: "ja", label: "Japanese" },
            {
              value: "de",
              label: prefs.austrianMode ? "Austrian German" : "German",
            },
          ]}
        />
      </section>

      {!currentCard ? (
        <section className="hig-card p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--status-success-bg)] text-[var(--status-success)]">
            <CheckCircle2 className="h-6 w-6" strokeWidth={2} />
          </div>
          <h2 className="text-[19px] font-semibold text-[var(--ink-primary)]">
            All due reviews complete
          </h2>
          <p className="mx-auto max-w-md text-[14px] leading-relaxed text-[var(--ink-secondary)]">
            Your scheduled SuperMemo-2 reviews for today are clear. Come back tomorrow or review upcoming cards early.
          </p>
          <button
            id="practice-study-ahead-btn"
            type="button"
            onClick={() => setStudyAhead(true)}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-[var(--bg-inset)] px-5 text-[14px] font-semibold text-[var(--accent)]"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={1.9} />
            <span>Practice Ahead of Schedule</span>
          </button>
        </section>
      ) : (
        <section aria-label="Active flashcard" className="space-y-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentCard.id}
              initial={
                prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }
              }
              animate={{ opacity: 1, y: 0 }}
              exit={
                prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }
              }
              transition={revealTransition}
              className="hig-card p-5 sm:p-7 space-y-5 min-w-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[12px] font-medium text-[var(--ink-secondary)]">
                  {currentCard.language === "ja"
                    ? "Japanese"
                    : prefs.austrianMode
                    ? "Austrian German"
                    : "German"}{" "}
                  · {TIER_META[currentCard.tier].shortLabel}
                </span>

                {revealed && (
                  <button
                    id="practice-card-audio-btn"
                    type="button"
                    onClick={() =>
                      void speakText({
                        text: resolveCardTarget(currentCard),
                        language: currentCard.language,
                        austrianMode: prefs.austrianMode,
                        rate: 0.96,
                      })
                    }
                    aria-label="Play phrase audio"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3.5 text-[13px] font-semibold text-[var(--accent)]"
                  >
                    <Volume2 className="h-4 w-4" strokeWidth={2} />
                    <span>Listen</span>
                  </button>
                )}
              </div>

              <div className="py-3 text-center space-y-2 min-w-0">
                <div className="text-[13px] font-medium text-[var(--ink-secondary)]">
                  Express in{" "}
                  {currentCard.language === "ja"
                    ? "Japanese"
                    : prefs.austrianMode
                    ? "Austrian German"
                    : "German"}
                </div>
                <div className="text-[22px] sm:text-[25px] font-semibold leading-snug text-[var(--ink-primary)] break-words">
                  {currentCard.frontPrompt}
                </div>
              </div>

              {!revealed ? (
                <motion.button
                  id="practice-reveal-btn"
                  type="button"
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                  onClick={() => {
                    setRevealedCardId(currentCard.id);
                    void speakText({
                      text: resolveCardTarget(currentCard),
                      language: currentCard.language,
                      austrianMode: prefs.austrianMode,
                      rate: 0.96,
                    });
                  }}
                  className="flex min-h-[54px] w-full items-center justify-center rounded-2xl bg-[var(--bg-inset)] text-[15px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors"
                >
                  Tap to Reveal Answer
                </motion.button>
              ) : (
                <motion.div
                  initial={
                    prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  transition={revealTransition}
                  className="hig-inset p-4 sm:p-5 space-y-3 text-center min-w-0"
                >
                  <div className="text-[26px] sm:text-[30px] font-bold leading-snug text-[var(--ink-primary)] break-words">
                    {currentCard.language === "ja" ? (
                      <RubyText
                        rubyHtml={currentCard.rubyHtml}
                        fallbackText={resolveCardTarget(currentCard)}
                        showFurigana={prefs.showFurigana}
                      />
                    ) : (
                      <CompoundWordText
                        surface={resolveCardTarget(currentCard)}
                        compoundParts={
                          prefs.austrianMode
                            ? currentCard.compoundParts
                            : undefined
                        }
                        showDividers={prefs.showCompoundDividers}
                      />
                    )}
                  </div>

                  {currentCard.reading && (
                    <div className="text-[14px] text-[var(--ink-secondary)]">
                      {currentCard.reading}
                    </div>
                  )}

                  {currentCard.austrianNote && (
                    <div className="text-[12px] text-[var(--accent)] font-medium">
                      {currentCard.austrianNote}
                    </div>
                  )}

                  <div className="hig-hairline-t pt-3 space-y-1 text-left">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[15px] font-medium text-[var(--ink-primary)] break-words min-w-0">
                        {currentCard.language === "ja" ? (
                          <RubyText
                            rubyHtml={currentCard.contextRubyHtml}
                            fallbackText={currentCard.contextSentence}
                            showFurigana={prefs.showFurigana}
                          />
                        ) : (
                          currentCard.contextSentence
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void speakText({
                            text: currentCard.contextSentence,
                            language: currentCard.language,
                            austrianMode: prefs.austrianMode,
                            rate: 0.95,
                          })
                        }
                        aria-label="Play example sentence"
                        className="inline-flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                      >
                        <Volume2 className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                    </div>
                    <div className="text-[13px] text-[var(--ink-secondary)]">
                      {currentCard.contextTranslation}
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>

          {revealed && intervals && (
            <motion.div
              initial={
                prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }
              }
              animate={{ opacity: 1, y: 0 }}
              transition={revealTransition}
              className="grid grid-cols-4 gap-2"
            >
              {(
                [
                  {
                    grade: "again",
                    label: "Again",
                    tone: "text-[var(--status-danger)]",
                  },
                  {
                    grade: "hard",
                    label: "Hard",
                    tone: "text-[var(--status-warn)]",
                  },
                  {
                    grade: "good",
                    label: "Good",
                    tone: "text-[var(--accent)]",
                  },
                  {
                    grade: "easy",
                    label: "Easy",
                    tone: "text-[var(--status-success)]",
                  },
                ] as const
              ).map((btn) => (
                <motion.button
                  key={btn.grade}
                  id={`srs-grade-${btn.grade}`}
                  type="button"
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                  onClick={() => void handleGrade(btn.grade)}
                  className="hig-card flex min-h-[58px] flex-col items-center justify-center px-2 py-2 text-center"
                >
                  <span className={`text-[14px] font-semibold ${btn.tone}`}>
                    {btn.label}
                  </span>
                  <span className="mt-0.5 text-[12px] text-[var(--ink-secondary)] tabular-nums">
                    {intervals[btn.grade]}
                  </span>
                </motion.button>
              ))}
            </motion.div>
          )}
        </section>
      )}
    </div>
  );
}
