import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Pause,
  Play,
  Volume2,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { offlineDb } from "../db/offlineDb";
import {
  type GradedStory,
  type LanguageCode,
  type StoryToken,
  TIER_META,
} from "../schemas/curriculum";
import { speakText, stopSpeaking } from "../services/speechService";
import type { UserPreferences } from "../state/preferences";
import {
  notifyOfflineDbChanged,
  type OfflineLibraryHandle,
} from "../state/useOfflineLibrary";
import { POPOVER_TRANSITION, resolveTransition } from "../utils/motionPresets";
import { CompoundWordText, RubyText } from "./ui/RubyText";
import { SegmentedControl } from "./ui/SegmentedControl";

export function StoriesView({
  prefs,
  updatePrefs,
  library,
  onNavigateCourses,
}: {
  prefs: UserPreferences;
  updatePrefs: (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void;
  library: OfflineLibraryHandle;
  onNavigateCourses: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const popoverTransition = resolveTransition(
    prefersReducedMotion,
    POPOVER_TRANSITION
  );

  const [langFilter, setLangFilter] = useState<"all" | LanguageCode>("all");
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [activeTokenKey, setActiveTokenKey] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<{
    token: StoryToken;
    language: LanguageCode;
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [readingParagraphIdx, setReadingParagraphIdx] = useState<number | null>(
    null
  );

  const readAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      readAbortRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  const stories = useMemo(() => {
    if (langFilter === "all") return library.eligibleStories;
    return library.eligibleStories.filter((s) => s.language === langFilter);
  }, [library.eligibleStories, langFilter]);

  const activeStory: GradedStory | null = useMemo(
    () =>
      library.eligibleStories.find((s) => s.id === selectedStoryId) ?? null,
    [library.eligibleStories, selectedStoryId]
  );

  const stopReadAloud = () => {
    readAbortRef.current?.abort();
    stopSpeaking();
    setReadingParagraphIdx(null);
  };

  const handleReadStoryAloud = async (story: GradedStory) => {
    if (readingParagraphIdx !== null) {
      stopReadAloud();
      return;
    }

    const controller = new AbortController();
    readAbortRef.current = controller;

    for (let i = 0; i < story.paragraphs.length; i += 1) {
      if (controller.signal.aborted) break;
      setReadingParagraphIdx(i);
      await speakText({
        text: story.paragraphs[i].nativeText,
        language: story.language,
        austrianMode: prefs.austrianMode,
        rate: prefs.storySpeechRate,
        signal: controller.signal,
      });
    }

    if (!controller.signal.aborted) {
      setReadingParagraphIdx(null);
    }
  };

  const handleAnswerQuestion = async (
    story: GradedStory,
    questionId: string,
    optionIdx: number
  ) => {
    const nextAnswers = { ...answers, [questionId]: optionIdx };
    setAnswers(nextAnswers);

    const allAnswered = story.questions.every(
      (q) => nextAnswers[q.id] !== undefined
    );
    if (allAnswered) {
      const score = story.questions.reduce(
        (acc, q) => acc + (nextAnswers[q.id] === q.correctIndex ? 1 : 0),
        0
      );
      await offlineDb.storyCompletions.put({
        storyId: story.id,
        unitId: story.unitId,
        language: story.language,
        completedAt: Date.now(),
        score,
      });
      notifyOfflineDbChanged();
    }
  };

  if (library.eligibleStories.length === 0) {
    return (
      <div className="space-y-4">
        <section className="hig-card p-4 sm:p-5">
          <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
            Stories
          </h1>
          <p className="mt-1 text-[14px] text-[var(--ink-secondary)]">
            Calm graded readings tailored to your active understanding tier.
          </p>
        </section>

        <section className="hig-card p-6 text-center space-y-4">
          <h2 className="text-[18px] font-semibold text-[var(--ink-primary)]">
            Download a unit to unlock graded stories
          </h2>
          <p className="mx-auto max-w-md text-[14px] leading-relaxed text-[var(--ink-secondary)]">
            Every unit includes level-matched stories with tap-word meanings, read-aloud audio, and comprehension checks.
          </p>
          <motion.button
            id="stories-empty-courses-cta"
            type="button"
            whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
            onClick={onNavigateCourses}
            className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-white"
          >
            <span>Open Courses</span>
            <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
          </motion.button>
        </section>
      </div>
    );
  }

  if (activeStory) {
    const completion = library.storyCompletionById.get(activeStory.id);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            id="story-back-btn"
            type="button"
            onClick={() => {
              stopReadAloud();
              setSelectedToken(null);
              setActiveTokenKey(null);
              setSelectedStoryId(null);
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--bg-pill)] px-3.5 text-[14px] font-medium text-[var(--ink-primary)]"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.9} />
            <span>Stories</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {activeStory.language === "ja" ? (
              <button
                id="story-furigana-toggle"
                type="button"
                onClick={() =>
                  updatePrefs({ showFurigana: !prefs.showFurigana })
                }
                className={`min-h-[40px] rounded-full px-3.5 text-[13px] font-medium ${
                  prefs.showFurigana
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "bg-[var(--bg-pill)] text-[var(--ink-secondary)]"
                }`}
              >
                Furigana {prefs.showFurigana ? "On" : "Off"}
              </button>
            ) : (
              <button
                id="story-compound-toggle"
                type="button"
                onClick={() =>
                  updatePrefs({
                    showCompoundDividers: !prefs.showCompoundDividers,
                  })
                }
                className={`min-h-[40px] rounded-full px-3.5 text-[13px] font-medium ${
                  prefs.showCompoundDividers
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "bg-[var(--bg-pill)] text-[var(--ink-secondary)]"
                }`}
              >
                Compound Dots {prefs.showCompoundDividers ? "On" : "Off"}
              </button>
            )}

            <button
              id="story-speed-toggle"
              type="button"
              onClick={() =>
                updatePrefs({
                  storySpeechRate: prefs.storySpeechRate === 1.0 ? 0.8 : 1.0,
                })
              }
              className="min-h-[40px] rounded-full bg-[var(--bg-pill)] px-3.5 text-[13px] font-semibold text-[var(--ink-primary)] tabular-nums"
            >
              {prefs.storySpeechRate.toFixed(1)}× Speed
            </button>

            <motion.button
              id="story-read-aloud-btn"
              type="button"
              whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
              onClick={() => void handleReadStoryAloud(activeStory)}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
            >
              {readingParagraphIdx !== null ? (
                <>
                  <Pause className="h-4 w-4" strokeWidth={2} />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" strokeWidth={2} />
                  <span>Read Aloud</span>
                </>
              )}
            </motion.button>
          </div>
        </div>

        <article className="hig-card p-5 sm:p-8 space-y-6">
          <header className="story-measure space-y-1.5">
            <div className="text-[13px] font-medium text-[var(--ink-secondary)]">
              {activeStory.setting} · {TIER_META[activeStory.tier].label}
            </div>
            <h1 className="text-[24px] sm:text-[28px] font-bold leading-tight text-[var(--ink-primary)]">
              {activeStory.title}
            </h1>
            <p className="text-[15px] text-[var(--ink-secondary)]">
              {activeStory.titleTranslation}
            </p>
          </header>

          <AnimatePresence>
            {selectedToken && (
              <motion.div
                key={activeTokenKey ?? "glossary-popover"}
                initial={
                  prefersReducedMotion
                    ? { opacity: 1 }
                    : { opacity: 0, scale: 0.96, y: -4 }
                }
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={
                  prefersReducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.96, y: -4 }
                }
                transition={popoverTransition}
                className="hig-inset story-measure p-4 flex items-start justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[19px] font-bold text-[var(--ink-primary)] break-words">
                      {selectedToken.token.compoundParts
                        ? selectedToken.token.compoundParts.join("·")
                        : selectedToken.token.surface}
                    </span>
                    {selectedToken.token.reading && (
                      <span className="text-[13px] text-[var(--ink-secondary)]">
                        {selectedToken.token.reading}
                      </span>
                    )}
                  </div>
                  <div className="text-[15px] font-medium text-[var(--ink-primary)]">
                    {selectedToken.token.meaning}
                  </div>
                  {selectedToken.token.regionalNote && (
                    <div className="text-[12px] text-[var(--accent)]">
                      {selectedToken.token.regionalNote}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void speakText({
                        text: selectedToken.token.surface,
                        language: selectedToken.language,
                        austrianMode: prefs.austrianMode,
                        rate: 0.92,
                      })
                    }
                    aria-label="Hear word aloud"
                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--accent)]"
                  >
                    <Volume2 className="h-4 w-4" strokeWidth={1.9} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedToken(null);
                      setActiveTokenKey(null);
                    }}
                    aria-label="Close word meaning"
                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--ink-secondary)]"
                  >
                    <X className="h-4 w-4" strokeWidth={1.9} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="story-measure space-y-5">
            {activeStory.paragraphs.map((paragraph, pIdx) => {
              const isReadingThis = readingParagraphIdx === pIdx;
              return (
                <div
                  key={pIdx}
                  className={`rounded-2xl transition-colors ${
                    isReadingThis ? "bg-[var(--accent-soft)] p-3 -mx-3" : ""
                  }`}
                >
                  <p className="text-[19px] sm:text-[20px] text-[var(--ink-primary)] leading-[2.05] break-words">
                    {paragraph.segments.map((token, tIdx) => {
                      const tokenKey = `${pIdx}-${tIdx}`;
                      const interactive = Boolean(token.meaning);
                      const isSelected = activeTokenKey === tokenKey;

                      if (!interactive) {
                        return <span key={tokenKey}>{token.surface}</span>;
                      }

                      return (
                        <button
                          key={tokenKey}
                          type="button"
                          onClick={() => {
                            setActiveTokenKey(tokenKey);
                            setSelectedToken({
                              token,
                              language: activeStory.language,
                            });
                          }}
                          className={`inline rounded-md px-0.5 transition-colors text-left ${
                            isSelected
                              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                              : "hover:bg-black/[0.05] dark:hover:bg-white/[0.08] decoration-dotted underline decoration-black/20 dark:decoration-white/25 underline-offset-4"
                          }`}
                        >
                          {activeStory.language === "ja" ? (
                            <RubyText
                              rubyHtml={token.rubyHtml}
                              fallbackText={token.surface}
                              showFurigana={prefs.showFurigana}
                            />
                          ) : (
                            <CompoundWordText
                              surface={token.surface}
                              compoundParts={token.compoundParts}
                              showDividers={prefs.showCompoundDividers}
                            />
                          )}
                        </button>
                      );
                    })}
                  </p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ink-secondary)]">
                    {paragraph.translation}
                  </p>
                </div>
              );
            })}
          </div>

          <section
            aria-labelledby="comprehension-heading"
            className="story-measure hig-hairline-t pt-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2
                id="comprehension-heading"
                className="text-[18px] font-semibold text-[var(--ink-primary)]"
              >
                Comprehension Check
              </h2>
              {completion && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-success-bg)] px-3 py-0.5 text-[12px] font-semibold text-[var(--status-success)] tabular-nums">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                  <span>{completion.score}/3 answered</span>
                </span>
              )}
            </div>

            <div className="space-y-4">
              {activeStory.questions.map((q, qIdx) => {
                const picked = answers[q.id];
                return (
                  <div key={q.id} className="hig-inset p-4 space-y-2.5">
                    <div className="text-[15px] font-semibold text-[var(--ink-primary)]">
                      {qIdx + 1}. {q.question}
                    </div>
                    <div className="space-y-1.5">
                      {q.options.map((opt, optIdx) => {
                        const isPicked = picked === optIdx;
                        const isRight = optIdx === q.correctIndex;

                        let btnClass =
                          "bg-[var(--bg-elevated)] text-[var(--ink-primary)]";
                        if (picked !== undefined) {
                          if (isRight) {
                            btnClass =
                              "bg-[var(--status-success-bg)] text-[var(--status-success)] font-semibold";
                          } else if (isPicked) {
                            btnClass =
                              "bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
                          }
                        }

                        return (
                          <button
                            key={optIdx}
                            type="button"
                            onClick={() =>
                              void handleAnswerQuestion(activeStory, q.id, optIdx)
                            }
                            className={`min-h-[44px] w-full rounded-xl px-3.5 py-2 text-left text-[14px] transition-colors break-words ${btnClass}`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                    {picked !== undefined && (
                      <p className="text-[13px] text-[var(--ink-secondary)] pt-1">
                        {q.explanation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </article>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="hig-card p-4 sm:p-5 space-y-4">
        <div>
          <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
            Stories
          </h1>
          <p className="mt-1 text-[14px] text-[var(--ink-secondary)]">
            Tap any word for instant meaning, toggle Furigana or German root dots, and listen aloud.
          </p>
        </div>

        <SegmentedControl<"all" | LanguageCode>
          id="stories-lang-filter"
          ariaLabel="Filter stories by language"
          compact
          value={langFilter}
          onChange={setLangFilter}
          options={[
            { value: "all", label: "All Stories" },
            { value: "ja", label: "Japanese" },
            {
              value: "de",
              label: prefs.austrianMode ? "Austrian German" : "German",
            },
          ]}
        />
      </section>

      <div className="space-y-3">
        {stories.map((story) => {
          const done = library.storyCompletionById.get(story.id);
          return (
            <button
              key={story.id}
              id={`open-story-${story.id}`}
              type="button"
              onClick={() => {
                setAnswers({});
                setSelectedToken(null);
                setActiveTokenKey(null);
                setSelectedStoryId(story.id);
              }}
              className="hig-card w-full p-4 sm:p-5 text-left hover:opacity-95 transition-opacity space-y-1.5 min-w-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink-secondary)]">
                  {story.language === "ja"
                    ? "Japanese"
                    : prefs.austrianMode
                    ? "Austrian German"
                    : "German"}{" "}
                  · {TIER_META[story.tier].shortLabel}
                </span>
                {done && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--status-success)] tabular-nums">
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                    <span>Read ({done.score}/3)</span>
                  </span>
                )}
              </div>

              <h2 className="text-[18px] font-semibold text-[var(--ink-primary)] break-words">
                {story.title}
              </h2>
              <p className="text-[14px] text-[var(--ink-secondary)]">
                {story.titleTranslation} · {story.setting}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
