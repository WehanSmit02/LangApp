import {
  CheckCircle2,
  ExternalLink,
  Keyboard,
  Mic,
  RefreshCw,
  Unlock,
  Volume2,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import type { CourseId } from "../schemas/curriculum";
import {
  isSpeechRecognitionSupported,
  listenOnce,
  resolveCourseSpeechLocales,
  speakText,
} from "../services/speechService";
import type { UserPreferences } from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import {
  normalizeCourseWeightsMap,
  resolveCourseDisplayName,
} from "../utils/formatters";
import { resolveTransition, SHEET_SPRING } from "../utils/motionPresets";
import {
  scoreBestSpeechMatch,
  scoreSingleCandidate,
} from "../utils/phoneticScore";
import { RubyText } from "./ui/RubyText";

interface LockPromptItem {
  id: string;
  courseId: CourseId;
  nativeText: string;
  rubyHtml?: string;
  reading?: string;
  meaning: string;
  extraReferences?: string[];
}

function isSafeRedirectScheme(rawScheme: string): boolean {
  const trimmed = rawScheme.trim();
  if (!trimmed) return false;
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return false;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
}

export function PhraseLockOverlay({
  prefs,
  updatePrefs,
  library,
  targetAppName,
  targetAppScheme,
  onClose,
}: {
  prefs: UserPreferences;
  updatePrefs: (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void;
  library: OfflineLibraryHandle;
  targetAppName?: string;
  targetAppScheme?: string;
  onClose: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const sheetTransition = resolveTransition(prefersReducedMotion, SHEET_SPRING);

  const [seedNonce, setSeedNonce] = useState<number>(() => Math.random());
  const [isListening, setIsListening] = useState<boolean>(false);
  const [spokenTranscript, setSpokenTranscript] = useState<string>("");
  const [score, setScore] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [typingMode, setTypingMode] = useState<boolean>(
    () => !isSpeechRecognitionSupported()
  );
  const [typedInput, setTypedInput] = useState<string>("");
  const [justUnlocked, setJustUnlocked] = useState<boolean>(false);

  const [mountedAtMs] = useState<number>(() => Date.now());

  const activeWindowRemainingMins = useMemo(() => {
    const diff = prefs.unlockExpiryMs - mountedAtMs;
    return diff > 0 ? Math.ceil(diff / 60_000) : 0;
  }, [prefs.unlockExpiryMs, mountedAtMs]);

  const normalizedWeights = useMemo(
    () => normalizeCourseWeightsMap(prefs.enrolledCourses),
    [prefs.enrolledCourses]
  );

  const promptItem: LockPromptItem = useMemo(() => {
    const lockCards = library.eligibleCards.filter((c) => c.phraseLockEligible);
    const cardPool =
      lockCards.length > 0 ? lockCards : library.eligibleCards;

    if (cardPool.length > 0) {
      const byCourse = new Map<CourseId, LockPromptItem[]>();
      for (const card of cardPool) {
        const variantId = prefs.enrolledCourses[card.courseId]?.activeVariantId;
        const resolvedNative =
          variantId && card.variantTargets?.[variantId]
            ? card.variantTargets[variantId]
            : card.targetText;
        const extraVariants = card.variantTargets
          ? Object.values(card.variantTargets)
          : [];

        const item: LockPromptItem = {
          id: card.id,
          courseId: card.courseId,
          nativeText: resolvedNative,
          rubyHtml:
            resolvedNative === card.targetText ? card.rubyHtml : undefined,
          reading: card.reading,
          meaning: card.frontPrompt,
          extraReferences: [card.targetText, ...extraVariants],
        };

        const arr = byCourse.get(card.courseId) ?? [];
        arr.push(item);
        byCourse.set(card.courseId, arr);
      }

      const courseIds = Array.from(byCourse.keys());
      const weightSum = courseIds.reduce(
        (sum, id) => sum + Math.max(0.5, normalizedWeights[id] ?? 1),
        0
      );

      const roll = ((seedNonce * 10_000) % 1000) / 1000;
      let cumulative = 0;
      let chosenCourseId = courseIds[0];

      for (const id of courseIds) {
        cumulative += Math.max(0.5, normalizedWeights[id] ?? 1) / weightSum;
        if (roll <= cumulative) {
          chosenCourseId = id;
          break;
        }
      }

      const bucket = byCourse.get(chosenCourseId) ?? [];
      const pickIdx = Math.floor((seedNonce * 9973) % bucket.length);
      return bucket[pickIdx];
    }

    const fallbackDescriptor = Array.from(
      library.descriptorsByCourseId.values()
    )[0];
    if (fallbackDescriptor) {
      return {
        id: `starter-${fallbackDescriptor.id}`,
        courseId: fallbackDescriptor.id,
        nativeText: fallbackDescriptor.nativeName,
        reading: fallbackDescriptor.name.toLowerCase(),
        meaning: `${fallbackDescriptor.name} (download Unit 1 for full phrase pool)`,
      };
    }

    return {
      id: "starter-universal",
      courseId: "en",
      nativeText: "Ready to focus",
      meaning: "Download Unit 1 in Courses to unlock native phrase prompts",
    };
  }, [
    library.eligibleCards,
    library.descriptorsByCourseId,
    prefs.enrolledCourses,
    normalizedWeights,
    seedNonce,
  ]);

  const promptDescriptor = library.descriptorsByCourseId.get(
    promptItem.courseId
  );
  const promptEnrollment = prefs.enrolledCourses[promptItem.courseId];
  const promptLocales = resolveCourseSpeechLocales(
    promptDescriptor,
    promptEnrollment?.activeVariantId
  );
  const promptCourseLabel = promptDescriptor
    ? resolveCourseDisplayName(
        promptItem.courseId,
        promptDescriptor,
        promptEnrollment?.activeVariantId
      )
    : "Starter Prompt";
  const promptDir = promptDescriptor?.textDirection ?? "ltr";

  const safeScheme =
    targetAppScheme && isSafeRedirectScheme(targetAppScheme)
      ? targetAppScheme
      : null;

  const grantUnlockAndRedirect = () => {
    const expiry = Date.now() + prefs.phraseLockDurationMinutes * 60_000;
    updatePrefs({ unlockExpiryMs: expiry });
    setJustUnlocked(true);

    if (safeScheme) {
      window.setTimeout(() => {
        window.location.assign(safeScheme);
      }, 420);
    }
  };

  const handleVoiceUnlock = async () => {
    setMicError(null);
    setSpokenTranscript("");
    setScore(null);
    setIsListening(true);

    const outcome = await listenOnce({
      sttLocale: promptLocales.sttLocale,
      timeoutMs: 6500,
      onInterim: (t) => setSpokenTranscript(t),
    });

    setIsListening(false);

    if (!outcome.supported || outcome.error === "not-allowed") {
      setMicError(
        "Microphone access is blocked or unavailable. Use Type to Unlock below."
      );
      setTypingMode(true);
      return;
    }

    const references = [
      promptItem.nativeText,
      promptItem.reading ?? "",
      ...(promptItem.extraReferences ?? []),
    ].filter(Boolean);

    const { bestScore, bestTranscript } = scoreBestSpeechMatch(
      outcome.candidates,
      references
    );
    setSpokenTranscript(bestTranscript);
    setScore(bestScore);

    if (bestScore >= prefs.phraseLockAccuracy) {
      grantUnlockAndRedirect();
    }
  };

  const handleCheckTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const references = [
      promptItem.nativeText,
      promptItem.reading ?? "",
      ...(promptItem.extraReferences ?? []),
    ].filter(Boolean);
    const typedScore = scoreSingleCandidate(typedInput, references);
    setScore(typedScore);
    if (typedScore >= prefs.phraseLockAccuracy) {
      grantUnlockAndRedirect();
    }
  };

  const handleNextPhrase = () => {
    setSeedNonce(Math.random());
    setScore(null);
    setSpokenTranscript("");
    setTypedInput("");
    setJustUnlocked(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phrase-lock-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 p-0 sm:p-4 backdrop-blur-sm"
    >
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.35 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 110) {
            onClose();
          }
        }}
        initial={
          prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: "100%" }
        }
        animate={{ opacity: 1, y: 0 }}
        exit={
          prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: "100%" }
        }
        transition={sheetTransition}
        className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-[26px] sm:rounded-[26px] bg-[var(--bg-canvas)] px-5 pt-3 pb-8 pb-safe shadow-2xl space-y-5"
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20 sm:hidden" />

        <div className="flex items-center justify-between gap-3">
          <div>
            <h2
              id="phrase-lock-title"
              className="text-[20px] font-bold text-[var(--ink-primary)]"
            >
              Phrase Lock
            </h2>
            <p className="text-[13px] text-[var(--ink-secondary)] tabular-nums">
              {targetAppName
                ? `Speak once to unlock ${targetAppName} for ${prefs.phraseLockDurationMinutes}m`
                : `Accuracy goal ${prefs.phraseLockAccuracy}% · ${prefs.phraseLockDurationMinutes}m window`}
            </p>
          </div>

          <button
            id="phrase-lock-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close Phrase Lock"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-5 w-5" strokeWidth={1.9} />
          </button>
        </div>

        {activeWindowRemainingMins > 0 && !justUnlocked && safeScheme && (
          <div className="hig-card p-3.5 flex items-center justify-between gap-3">
            <span className="text-[13px] text-[var(--ink-secondary)] tabular-nums">
              Active unlock window ({activeWindowRemainingMins}m left)
            </span>
            <a
              href={safeScheme}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 text-[13px] font-semibold text-white"
            >
              <span>Open {targetAppName || "App"}</span>
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
            </a>
          </div>
        )}

        <div className="hig-card p-6 text-center space-y-4">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-[var(--bg-pill)] px-3 py-1 text-[12px] font-medium text-[var(--ink-secondary)]">
              {promptCourseLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void speakText({
                    text: promptItem.nativeText,
                    locales: promptLocales.ttsLocales,
                    rate: 0.92,
                  })
                }
                aria-label="Hear target phrase"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3.5 text-[13px] font-semibold text-[var(--accent)]"
              >
                <Volume2 className="h-4 w-4" strokeWidth={2} />
                <span>Hear</span>
              </button>
              <button
                type="button"
                onClick={handleNextPhrase}
                aria-label="Pick another phrase"
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-[var(--bg-inset)] text-[var(--ink-secondary)]"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="py-2 space-y-2 min-w-0">
            <div
              dir={promptDir}
              className="text-[28px] sm:text-[32px] font-bold leading-snug text-[var(--ink-primary)] break-words"
            >
              {promptDescriptor?.readingFeatures.rubyAnnotations &&
              promptItem.rubyHtml ? (
                <RubyText
                  rubyHtml={promptItem.rubyHtml}
                  fallbackText={promptItem.nativeText}
                  showFurigana={promptEnrollment?.showRubyAnnotations ?? true}
                />
              ) : (
                promptItem.nativeText
              )}
            </div>
            {promptItem.reading && (
              <div className="text-[14px] text-[var(--ink-secondary)]">
                {promptItem.reading}
              </div>
            )}
            <div className="text-[16px] font-medium text-[var(--ink-primary)]">
              {promptItem.meaning}
            </div>
          </div>

          <div aria-live="polite" className="space-y-2">
            {spokenTranscript && (
              <div className="text-[14px] text-[var(--ink-secondary)]">
                Heard: “{spokenTranscript}”
              </div>
            )}

            {score !== null && !justUnlocked && (
              <div
                className={`rounded-xl px-3.5 py-2 text-[13px] font-medium tabular-nums ${
                  score >= prefs.phraseLockAccuracy
                    ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
                    : "bg-[var(--status-warn-bg)] text-[var(--status-warn)]"
                }`}
              >
                Match {score}% (need {prefs.phraseLockAccuracy}% — try once
                more)
              </div>
            )}

            {micError && (
              <div className="rounded-xl bg-[var(--status-warn-bg)] px-3.5 py-2 text-[13px] text-[var(--status-warn)]">
                {micError}
              </div>
            )}
          </div>

          {justUnlocked ? (
            <div className="rounded-2xl bg-[var(--status-success-bg)] p-4 space-y-3">
              <div className="flex items-center justify-center gap-2 text-[16px] font-semibold text-[var(--status-success)]">
                <CheckCircle2 className="h-5 w-5" strokeWidth={2.2} />
                <span>
                  Unlocked for {prefs.phraseLockDurationMinutes} minutes
                </span>
              </div>
              {safeScheme ? (
                <a
                  href={safeScheme}
                  className="inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-white"
                >
                  <Unlock className="h-4 w-4" strokeWidth={2} />
                  <span>Continue to {targetAppName || "App"}</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--bg-elevated)] px-5 text-[14px] font-semibold text-[var(--ink-primary)]"
                >
                  Done
                </button>
              )}
            </div>
          ) : !typingMode ? (
            <div className="space-y-3 pt-1">
              <motion.button
                id="phrase-lock-speak-btn"
                type="button"
                disabled={isListening}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                onClick={() => void handleVoiceUnlock()}
                className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 text-[16px] font-semibold text-white disabled:opacity-75"
              >
                <Mic
                  className={`h-5 w-5 ${isListening ? "animate-pulse" : ""}`}
                  strokeWidth={2}
                />
                <span>
                  {isListening ? "Listening now..." : "Tap and Speak Phrase"}
                </span>
              </motion.button>

              <button
                id="phrase-lock-type-fallback-toggle"
                type="button"
                onClick={() => setTypingMode(true)}
                className="inline-flex min-h-[42px] items-center gap-1.5 text-[13px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
              >
                <Keyboard className="h-4 w-4" strokeWidth={1.8} />
                <span>In a quiet room? Type to unlock</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleCheckTyped} className="space-y-2.5 pt-1">
              <input
                id="phrase-lock-type-input"
                dir={promptDir}
                type="text"
                value={typedInput}
                onChange={(e) => setTypedInput(e.target.value)}
                placeholder={
                  promptItem.reading
                    ? `Type "${promptItem.nativeText}" or "${promptItem.reading}"`
                    : `Type "${promptItem.nativeText}"`
                }
                className="min-h-[48px] w-full rounded-xl bg-[var(--bg-inset)] px-4 text-[15px] text-[var(--ink-primary)] placeholder:text-[var(--ink-secondary)]"
              />
              <div className="flex items-center gap-2">
                {isSpeechRecognitionSupported() && (
                  <button
                    type="button"
                    onClick={() => setTypingMode(false)}
                    className="min-h-[46px] rounded-full bg-[var(--bg-inset)] px-4 text-[14px] font-medium text-[var(--ink-secondary)]"
                  >
                    Use Mic
                  </button>
                )}
                <button
                  id="phrase-lock-submit-typed"
                  type="submit"
                  className="min-h-[46px] flex-1 rounded-full bg-[var(--accent)] px-5 text-[15px] font-semibold text-white"
                >
                  Check & Unlock
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
