import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Volume2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { offlineDb } from "../db/offlineDb";
import {
  type Drill,
  isTierIncluded,
  type LessonStep,
  TIER_META,
} from "../schemas/curriculum";
import {
  isSpeechRecognitionSupported,
  listenOnce,
  speakText,
  stopSpeaking,
} from "../services/speechService";
import { ScreenWakeLockController } from "../services/wakeLockService";
import type { UserPreferences } from "../state/preferences";
import {
  notifyOfflineDbChanged,
  type OfflineLibraryHandle,
} from "../state/useOfflineLibrary";
import { scoreBestSpeechMatch } from "../utils/phoneticScore";
import { CompoundWordText, RubyText } from "./ui/RubyText";
import { SegmentedControl } from "./ui/SegmentedControl";

type StudioMode = "guided" | "handsfree";
type LoopPhase =
  | "idle"
  | "scenario"
  | "slow-native"
  | "natural-native"
  | "listening"
  | "shadow-pause"
  | "feedback"
  | "finished";

export function LessonStudio({
  unitId,
  prefs,
  updatePrefs,
  library,
  onClose,
}: {
  unitId: string;
  prefs: UserPreferences;
  updatePrefs: (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void;
  library: OfflineLibraryHandle;
  onClose: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [mode, setMode] = useState<StudioMode>("guided");
  const [drillSelections, setDrillSelections] = useState<Record<string, string>>(
    {}
  );
  const [unitMarkedDone, setUnitMarkedDone] = useState<boolean>(() =>
    library.completionByUnitId.has(unitId)
  );

  const storedMeta = library.metaByUnitId.get(unitId);
  const unitShards = useMemo(() => {
    const raw = library.shardsByUnitId.get(unitId) ?? [];
    if (!storedMeta) return raw;
    const userTier = prefs.tiers[storedMeta.language];
    return raw.filter((s) => isTierIncluded(s.tier, userTier));
  }, [library.shardsByUnitId, unitId, storedMeta, prefs.tiers]);

  const language = storedMeta?.language ?? unitShards[0]?.language ?? "ja";
  const steps = useMemo(
    () => unitShards.flatMap((s) => s.payload.lessonSteps),
    [unitShards]
  );
  const drills = useMemo(
    () => unitShards.flatMap((s) => s.payload.drills),
    [unitShards]
  );

  const resolveStepNative = useCallback(
    (step: LessonStep): string => {
      if (
        language === "de" &&
        !prefs.austrianMode &&
        step.standardGermanVariant
      ) {
        return step.standardGermanVariant.nativeText;
      }
      return step.nativeText;
    },
    [language, prefs.austrianMode]
  );

  const resolveDrillExpected = (drill: Drill): string => {
    if (
      language === "de" &&
      !prefs.austrianMode &&
      drill.standardGermanAnswer &&
      drill.options.includes(drill.standardGermanAnswer)
    ) {
      return drill.standardGermanAnswer;
    }
    return drill.correctAnswer;
  };

  const handlePlayPhrase = (text: string, rate: number) => {
    void speakText({
      text,
      language,
      austrianMode: prefs.austrianMode,
      rate,
    });
  };

  const drillAnsweredCount = Object.keys(drillSelections).length;

  const handleCompleteUnit = useCallback(
    async (handsFreeDone = false) => {
      await offlineDb.lessonCompletions.put({
        unitId,
        language,
        completedAt: Date.now(),
        drillsCompleted: drillAnsweredCount,
        handsFreeCompleted: handsFreeDone,
      });
      setUnitMarkedDone(true);
      notifyOfflineDbChanged();

      if (storedMeta) {
        void library.triggerWifiPrefetchAfterUnit(
          language,
          storedMeta.unitNumber
        );
      }
    },
    [unitId, language, drillAnsweredCount, storedMeta, library]
  );

  const [hfIndex, setHfIndex] = useState<number>(0);
  const [hfRunning, setHfRunning] = useState<boolean>(false);
  const [hfPhase, setHfPhase] = useState<LoopPhase>("idle");
  const [hfInterim, setHfInterim] = useState<string>("");
  const [hfScore, setHfScore] = useState<number | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [sttFallbackNotice, setSttFallbackNotice] = useState<string | null>(
    null
  );

  const wakeLockRef = useRef<ScreenWakeLockController | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSelectMode = (nextMode: StudioMode) => {
    if (nextMode !== "handsfree") {
      abortRef.current?.abort();
      stopSpeaking();
      setHfRunning(false);
      setHfPhase("idle");
      void wakeLockRef.current?.release();
      setWakeLockActive(false);
    }
    setMode(nextMode);
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopSpeaking();
      void wakeLockRef.current?.release();
    };
  }, []);

  useEffect(() => {
    if (!hfRunning || mode !== "handsfree" || steps.length === 0) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    if (!wakeLockRef.current) {
      wakeLockRef.current = new ScreenWakeLockController();
    }

    const runStepCycle = async () => {
      const locked = await wakeLockRef.current!.acquire();
      if (!cancelled) setWakeLockActive(locked);

      const currentStep = steps[hfIndex];
      if (!currentStep) {
        setHfPhase("finished");
        setHfRunning(false);
        await handleCompleteUnit(true);
        return;
      }

      const targetPhrase = resolveStepNative(currentStep);
      setHfInterim("");
      setHfScore(null);

      setHfPhase("scenario");
      await speakText({
        text: currentStep.scenarioPrompt,
        language: "en",
        rate: 1.0,
        signal: controller.signal,
      });
      if (cancelled || controller.signal.aborted) return;

      setHfPhase("slow-native");
      await speakText({
        text: targetPhrase,
        language,
        austrianMode: prefs.austrianMode,
        rate: 0.82,
        signal: controller.signal,
      });
      if (cancelled || controller.signal.aborted) return;

      await new Promise((r) => window.setTimeout(r, 380));
      if (cancelled || controller.signal.aborted) return;

      setHfPhase("natural-native");
      await speakText({
        text: targetPhrase,
        language,
        austrianMode: prefs.austrianMode,
        rate: 0.98,
        signal: controller.signal,
      });
      if (cancelled || controller.signal.aborted) return;

      if (isSpeechRecognitionSupported()) {
        setHfPhase("listening");
        const rec = await listenOnce({
          language,
          austrianMode: prefs.austrianMode,
          timeoutMs: 6500,
          onInterim: (t) => {
            if (!cancelled) setHfInterim(t);
          },
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted) return;

        if (
          rec.error === "not-allowed" ||
          rec.error === "service-not-allowed" ||
          !rec.supported
        ) {
          setSttFallbackNotice(
            "Microphone unavailable — using timed shadowing pause so you can repeat aloud hands-free."
          );
          setHfPhase("shadow-pause");
          await new Promise((r) => window.setTimeout(r, 4200));
        } else {
          const references = [
            targetPhrase,
            currentStep.nativeText,
            currentStep.romanization ?? "",
          ].filter(Boolean);
          const { bestScore, bestTranscript } = scoreBestSpeechMatch(
            rec.candidates,
            references,
            language
          );
          setHfInterim(bestTranscript);
          setHfScore(bestScore);
          setHfPhase("feedback");
          await new Promise((r) => window.setTimeout(r, 1500));
        }
      } else {
        setSttFallbackNotice(
          "Speech recognition isn't supported in this browser — timed shadowing pause active."
        );
        setHfPhase("shadow-pause");
        await new Promise((r) => window.setTimeout(r, 4500));
      }

      if (cancelled || controller.signal.aborted) return;

      if (hfIndex + 1 < steps.length) {
        setHfIndex((idx) => idx + 1);
      } else {
        setHfPhase("finished");
        setHfRunning(false);
        await handleCompleteUnit(true);
      }
    };

    void runStepCycle();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    hfRunning,
    hfIndex,
    mode,
    steps,
    language,
    prefs.austrianMode,
    resolveStepNative,
    handleCompleteUnit,
  ]);

  const currentHfStep = steps[hfIndex] ?? steps[0];

  const phaseStatusText: Record<LoopPhase, string> = {
    idle: "Tap Start Loop for eyes-free listening and speaking practice.",
    scenario: "Listening to scenario prompt...",
    "slow-native": "Playing slow reference (0.82×)...",
    "natural-native": "Playing natural cadence (0.98×)...",
    listening: "Your turn — speak the phrase aloud",
    "shadow-pause": "Repeat the phrase aloud now...",
    feedback:
      hfScore !== null
        ? `Similarity ${hfScore}% — advancing to next prompt`
        : "Advancing to next prompt...",
    finished: "Hands-Free unit loop complete",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          id="studio-back-btn"
          type="button"
          onClick={() => {
            stopSpeaking();
            onClose();
          }}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--bg-pill)] px-3.5 text-[14px] font-medium text-[var(--ink-primary)]"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.9} />
          <span>Courses</span>
        </button>

        {language === "ja" ? (
          <button
            id="studio-furigana-toggle"
            type="button"
            onClick={() => updatePrefs({ showFurigana: !prefs.showFurigana })}
            className={`min-h-[40px] rounded-full px-3.5 text-[13px] font-medium transition-colors ${
              prefs.showFurigana
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "bg-[var(--bg-pill)] text-[var(--ink-secondary)]"
            }`}
          >
            Furigana {prefs.showFurigana ? "On" : "Off"}
          </button>
        ) : (
          <button
            id="studio-compound-toggle"
            type="button"
            onClick={() =>
              updatePrefs({ showCompoundDividers: !prefs.showCompoundDividers })
            }
            className={`min-h-[40px] rounded-full px-3.5 text-[13px] font-medium transition-colors ${
              prefs.showCompoundDividers
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "bg-[var(--bg-pill)] text-[var(--ink-secondary)]"
            }`}
          >
            Root Dots {prefs.showCompoundDividers ? "On" : "Off"}
          </button>
        )}
      </div>

      <div className="hig-card p-4 sm:p-5 space-y-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[var(--ink-secondary)]">
            Unit {storedMeta?.unitNumber ?? 1} ·{" "}
            {language === "ja"
              ? "Japanese"
              : prefs.austrianMode
              ? "Austrian German"
              : "Standard German"}
          </div>
          <h1 className="mt-0.5 text-[22px] font-bold leading-tight text-[var(--ink-primary)]">
            {storedMeta?.meta.title ?? "Lesson Studio"}
          </h1>
          {storedMeta?.meta.summary && (
            <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ink-secondary)] story-measure">
              {storedMeta.meta.summary}
            </p>
          )}
        </div>

        <SegmentedControl<StudioMode>
          id="lesson-studio-mode"
          ariaLabel="Lesson Studio Mode"
          value={mode}
          onChange={handleSelectMode}
          options={[
            { value: "guided", label: "Guided Mode" },
            { value: "handsfree", label: "Hands-Free Audio" },
          ]}
        />
      </div>

      {mode === "guided" ? (
        <div className="space-y-4">
          {storedMeta?.meta.culturalInsight && (
            <section className="hig-card p-4 sm:p-5 story-measure">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--accent)]">
                <Sparkles className="h-4 w-4" strokeWidth={1.9} />
                <span>Cultural Context</span>
              </div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ink-secondary)]">
                {storedMeta.meta.culturalInsight}
              </p>
            </section>
          )}

          <section aria-label="Pattern Cards" className="space-y-3">
            {steps.map((step, idx) => {
              const displayTarget = resolveStepNative(step);
              return (
                <article
                  key={step.id}
                  className="hig-card p-4 sm:p-5 space-y-3 min-w-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[16px] font-semibold text-[var(--ink-primary)] min-w-0">
                      {idx + 1}. {step.heading}
                    </h2>
                    <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink-secondary)]">
                      {TIER_META[step.tier].shortLabel}
                    </span>
                  </div>

                  <p className="text-[14px] leading-relaxed text-[var(--ink-secondary)] story-measure">
                    {step.explanation}
                  </p>

                  <div className="hig-inset p-4 space-y-2 min-w-0">
                    <div className="text-[21px] sm:text-[23px] font-semibold text-[var(--ink-primary)] break-words">
                      {language === "ja" ? (
                        <RubyText
                          rubyHtml={step.rubyHtml}
                          fallbackText={displayTarget}
                          showFurigana={prefs.showFurigana}
                        />
                      ) : step.compoundParts && prefs.austrianMode ? (
                        <CompoundWordText
                          surface={displayTarget}
                          compoundParts={
                            step.compoundParts.join("").toLowerCase() ===
                            displayTarget
                              .replace(/[.,!?]/g, "")
                              .toLowerCase()
                              ? step.compoundParts
                              : undefined
                          }
                          showDividers={prefs.showCompoundDividers}
                        />
                      ) : (
                        displayTarget
                      )}
                    </div>

                    {step.romanization && (
                      <div className="text-[13px] text-[var(--ink-secondary)]">
                        {step.romanization}
                      </div>
                    )}

                    <div className="text-[15px] font-medium text-[var(--ink-primary)]">
                      {step.translation}
                    </div>

                    {step.compoundParts && step.compoundParts.length >= 2 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {step.compoundParts.map((part, pIdx) => (
                          <span
                            key={`${step.id}-part-${pIdx}`}
                            className="rounded-lg bg-[var(--bg-elevated)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink-secondary)]"
                          >
                            {part}
                          </span>
                        ))}
                      </div>
                    )}

                    {language === "de" && step.standardGermanVariant && (
                      <div className="pt-1 text-[12px] text-[var(--ink-secondary)]">
                        {prefs.austrianMode
                          ? `Standard German: ${step.standardGermanVariant.nativeText} (${step.standardGermanVariant.note})`
                          : `Austrian form: ${step.nativeText}`}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <motion.button
                        type="button"
                        whileTap={
                          prefersReducedMotion ? undefined : { scale: 0.97 }
                        }
                        onClick={() => handlePlayPhrase(displayTarget, 0.98)}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
                      >
                        <Volume2 className="h-4 w-4" strokeWidth={2} />
                        <span>Listen</span>
                      </motion.button>
                      <button
                        type="button"
                        onClick={() => handlePlayPhrase(displayTarget, 0.8)}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3.5 text-[13px] font-medium text-[var(--ink-primary)]"
                      >
                        <span>Slow (0.8×)</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          {drills.length > 0 && (
            <section
              aria-labelledby="drills-heading"
              className="hig-card p-4 sm:p-5 space-y-4"
            >
              <div>
                <h2
                  id="drills-heading"
                  className="text-[18px] font-semibold text-[var(--ink-primary)]"
                >
                  Sentence Transformation Drills
                </h2>
                <p className="text-[13px] text-[var(--ink-secondary)]">
                  Tap the natural transformation to check immediately and hear it aloud.
                </p>
              </div>

              <div className="divide-y divide-[var(--hairline)]">
                {drills.map((drill, dIdx) => {
                  const chosen = drillSelections[drill.id];
                  const expected = resolveDrillExpected(drill);
                  const isCorrect =
                    chosen === expected ||
                    (chosen !== undefined &&
                      drill.acceptedVariants?.includes(chosen));

                  return (
                    <div key={drill.id} className="py-4 first:pt-1 last:pb-1 space-y-3">
                      <div className="space-y-1">
                        <div className="text-[14px] font-semibold text-[var(--ink-primary)]">
                          {dIdx + 1}. {drill.prompt}
                        </div>
                        {drill.baseSentence && (
                          <div className="text-[13px] text-[var(--ink-secondary)]">
                            Base: {drill.baseSentence}
                          </div>
                        )}
                        <div className="text-[13px] font-medium text-[var(--accent)]">
                          Cue: {drill.cue}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {drill.options.map((option) => {
                          const isSelected = chosen === option;
                          const optionRight = option === expected;

                          let styleClass =
                            "bg-[var(--bg-inset)] text-[var(--ink-primary)]";
                          if (chosen) {
                            if (optionRight) {
                              styleClass =
                                "bg-[var(--status-success-bg)] text-[var(--status-success)] font-semibold";
                            } else if (isSelected) {
                              styleClass =
                                "bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
                            }
                          }

                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setDrillSelections((prev) => ({
                                  ...prev,
                                  [drill.id]: option,
                                }));
                                if (option === expected) {
                                  handlePlayPhrase(option, 0.96);
                                }
                              }}
                              className={`min-h-[46px] rounded-xl px-3.5 py-2.5 text-left text-[14px] transition-colors min-w-0 break-words ${styleClass}`}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>

                      {chosen && (
                        <div
                          className={`rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                            isCorrect
                              ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
                              : "bg-[var(--bg-inset)] text-[var(--ink-secondary)]"
                          }`}
                        >
                          {drill.explanation}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="hig-card p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-[14px] text-[var(--ink-secondary)]">
              {unitMarkedDone
                ? "Unit completed — flashcards and stories remain ready offline."
                : "Finish this unit to log progress and queue next units on Wi-Fi."}
            </div>
            <motion.button
              id="studio-complete-unit-btn"
              type="button"
              whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
              onClick={() => void handleCompleteUnit(false)}
              className={`inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-full px-6 text-[15px] font-semibold ${
                unitMarkedDone
                  ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
                  : "bg-[var(--accent)] text-white"
              }`}
            >
              {unitMarkedDone ? (
                <>
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                  <span>Completed</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" strokeWidth={2} />
                  <span>Complete Unit</span>
                </>
              )}
            </motion.button>
          </div>
        </div>
      ) : (
        <section
          aria-label="Hands-Free Audio Loop"
          className="hig-card p-6 sm:p-8 flex flex-col items-center text-center space-y-6"
        >
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[12px] font-medium text-[var(--ink-secondary)] tabular-nums">
              <Headphones className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>
                Prompt {Math.min(hfIndex + 1, Math.max(1, steps.length))} of{" "}
                {steps.length}
              </span>
            </span>
            {wakeLockActive && (
              <span className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[12px] font-medium text-[var(--accent)]">
                Screen Awake
              </span>
            )}
          </div>

          <div
            aria-live="polite"
            className="text-[14px] font-medium text-[var(--accent)]"
          >
            {phaseStatusText[hfPhase]}
          </div>

          <div className="relative flex h-28 w-28 items-center justify-center">
            <motion.div
              animate={
                hfRunning && !prefersReducedMotion
                  ? {
                      scale:
                        hfPhase === "listening" ? [1, 1.24, 1] : [1, 1.1, 1],
                      opacity: [0.35, 0.7, 0.35],
                    }
                  : { scale: 1, opacity: 0.2 }
              }
              transition={{
                duration: hfPhase === "listening" ? 1.1 : 2.0,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute inset-0 rounded-full bg-[var(--accent)]"
            />
            <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg">
              {hfPhase === "listening" ? (
                <Mic className="h-8 w-8" strokeWidth={1.9} />
              ) : hfPhase === "shadow-pause" ? (
                <MicOff className="h-7 w-7" strokeWidth={1.9} />
              ) : (
                <Volume2 className="h-8 w-8" strokeWidth={1.9} />
              )}
            </div>
          </div>

          {currentHfStep && (
            <AnimatePresence mode="wait">
              <motion.div
                key={currentHfStep.id}
                initial={
                  prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }
                }
                animate={{ opacity: 1, y: 0 }}
                exit={
                  prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }
                }
                transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
                className="max-w-lg space-y-3 min-w-0"
              >
                <p className="text-[15px] text-[var(--ink-secondary)]">
                  {currentHfStep.scenarioPrompt}
                </p>
                <div className="text-[28px] sm:text-[32px] font-bold leading-snug text-[var(--ink-primary)] break-words">
                  {language === "ja" ? (
                    <RubyText
                      rubyHtml={currentHfStep.rubyHtml}
                      fallbackText={resolveStepNative(currentHfStep)}
                      showFurigana={prefs.showFurigana}
                    />
                  ) : (
                    resolveStepNative(currentHfStep)
                  )}
                </div>
                <div className="text-[16px] text-[var(--ink-secondary)]">
                  {currentHfStep.translation}
                </div>

                {hfInterim && (
                  <div className="rounded-xl bg-[var(--bg-inset)] px-4 py-2 text-[14px] text-[var(--ink-primary)]">
                    Heard: “{hfInterim}”
                    {hfScore !== null && (
                      <span className="ml-2 font-semibold text-[var(--accent)] tabular-nums">
                        ({hfScore}%)
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {sttFallbackNotice && (
            <div className="max-w-md rounded-2xl bg-[var(--bg-inset)] px-4 py-2.5 text-[13px] text-[var(--ink-secondary)]">
              {sttFallbackNotice}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              id="hf-restart-btn"
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                stopSpeaking();
                setHfIndex(0);
                setHfPhase("idle");
                setHfRunning(true);
              }}
              aria-label="Restart loop from first phrase"
              className="inline-flex min-h-[50px] min-w-[50px] items-center justify-center rounded-full bg-[var(--bg-inset)] text-[var(--ink-primary)]"
            >
              <RotateCcw className="h-5 w-5" strokeWidth={1.9} />
            </button>

            <motion.button
              id="hf-toggle-btn"
              type="button"
              whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
              onClick={() => {
                if (hfRunning) {
                  abortRef.current?.abort();
                  stopSpeaking();
                  setHfRunning(false);
                  setHfPhase("idle");
                } else {
                  if (hfPhase === "finished") {
                    setHfIndex(0);
                  }
                  setHfRunning(true);
                }
              }}
              className="inline-flex min-h-[54px] min-w-[168px] items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-7 text-[16px] font-semibold text-white"
            >
              {hfRunning ? (
                <>
                  <Pause className="h-5 w-5" strokeWidth={2} />
                  <span>Pause Loop</span>
                </>
              ) : (
                <>
                  <Play className="h-5 w-5" strokeWidth={2} />
                  <span>Start Loop</span>
                </>
              )}
            </motion.button>

            <button
              id="hf-skip-btn"
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                stopSpeaking();
                setHfIndex((idx) => (idx + 1 < steps.length ? idx + 1 : 0));
              }}
              aria-label="Skip to next prompt"
              className="inline-flex min-h-[50px] min-w-[50px] items-center justify-center rounded-full bg-[var(--bg-inset)] text-[var(--ink-primary)]"
            >
              <SkipForward className="h-5 w-5" strokeWidth={1.9} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
