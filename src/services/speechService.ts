import type { LanguageCode } from "../schemas/curriculum";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionConstructor() !== null;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let cachedVoices: SpeechSynthesisVoice[] = [];

function refreshVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSynthesisSupported()) return [];
  const list = window.speechSynthesis.getVoices();
  if (list.length > 0) {
    cachedVoices = list;
  }
  return cachedVoices;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    refreshVoices();
  };
}

function selectVoice(
  targetBcp47: string,
  fallbackPrefix: string
): { voice: SpeechSynthesisVoice | null; resolvedLang: string } {
  const voices = refreshVoices();
  const normalizedTarget = targetBcp47.toLowerCase().replace("_", "-");
  const normalizedPrefix = fallbackPrefix.toLowerCase();

  const exactMatches = voices.filter(
    (v) => v.lang.toLowerCase().replace("_", "-") === normalizedTarget
  );
  if (exactMatches.length > 0) {
    const preferred =
      exactMatches.find((v) => v.localService) ?? exactMatches[0];
    return { voice: preferred, resolvedLang: targetBcp47 };
  }

  const prefixMatches = voices.filter((v) =>
    v.lang.toLowerCase().replace("_", "-").startsWith(normalizedPrefix)
  );
  if (prefixMatches.length > 0) {
    const deDeMatch = prefixMatches.find((v) =>
      v.lang.toLowerCase().replace("_", "-").startsWith("de-de")
    );
    const chosen =
      deDeMatch ?? prefixMatches.find((v) => v.localService) ?? prefixMatches[0];
    return { voice: chosen, resolvedLang: chosen.lang || fallbackPrefix };
  }

  return { voice: null, resolvedLang: targetBcp47 };
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}

export function speakText(options: {
  text: string;
  language: LanguageCode | "en";
  austrianMode?: boolean;
  rate?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const { text, language, austrianMode = true, rate = 1.0, signal } = options;

  if (signal?.aborted) {
    return Promise.resolve();
  }

  if (!isSpeechSynthesisSupported() || !text.trim()) {
    const fallbackMs = Math.min(2500, Math.max(500, text.length * 45));
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, fallbackMs);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }

  return new Promise((resolve) => {
    // Safari cancels queued SpeechSynthesis unless prior active speech is cleared cleanly
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const requestedTag =
      language === "en"
        ? "en-US"
        : language === "ja"
        ? "ja-JP"
        : austrianMode
        ? "de-AT"
        : "de-DE";
    const fallbackPrefix =
      language === "en" ? "en" : language === "ja" ? "ja" : "de";

    const { voice, resolvedLang } = selectVoice(requestedTag, fallbackPrefix);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.lang = resolvedLang;
    utterance.rate = rate;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      resolve();
    };

    // Chromium on Android/Linux occasionally drops onend on longer utterances
    const estimatedMs = Math.max(3500, Math.ceil((text.length * 140) / rate) + 2200);
    const watchdog = window.setTimeout(finish, estimatedMs);

    utterance.onend = finish;
    utterance.onerror = finish;

    signal?.addEventListener(
      "abort",
      () => {
        window.speechSynthesis.cancel();
        finish();
      },
      { once: true }
    );

    window.speechSynthesis.speak(utterance);
  });
}

export interface RecognitionOutcome {
  supported: boolean;
  candidates: string[];
  error?: string;
}

export function listenOnce(options: {
  language: LanguageCode;
  austrianMode?: boolean;
  timeoutMs?: number;
  onInterim?: (transcript: string) => void;
  signal?: AbortSignal;
}): Promise<RecognitionOutcome> {
  const {
    language,
    austrianMode = true,
    timeoutMs = 6500,
    onInterim,
    signal,
  } = options;

  const RecognitionCtor = getRecognitionConstructor();
  if (!RecognitionCtor) {
    return Promise.resolve({ supported: false, candidates: [] });
  }

  return new Promise((resolve) => {
    const recognition = new RecognitionCtor();
    recognition.lang =
      language === "ja" ? "ja-JP" : austrianMode ? "de-AT" : "de-DE";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 4;

    const collectedCandidates: string[] = [];
    let latestInterim = "";
    let lastError: string | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (collectedCandidates.length === 0 && latestInterim.trim()) {
        collectedCandidates.push(latestInterim.trim());
      }
      resolve({
        supported: true,
        candidates: collectedCandidates,
        error: lastError,
      });
    };

    const timer = window.setTimeout(() => {
      try {
        recognition.stop();
      } catch {
        finish();
      }
    }, timeoutMs);

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (res.isFinal) {
          for (let a = 0; a < res.length; a += 1) {
            const transcript = res[a]?.transcript?.trim();
            if (transcript) {
              collectedCandidates.push(transcript);
            }
          }
        } else if (res[0]?.transcript) {
          interim += res[0].transcript;
        }
      }
      if (interim) {
        latestInterim = interim;
        onInterim?.(interim);
      } else if (collectedCandidates[0]) {
        onInterim?.(collectedCandidates[0]);
      }
    };

    recognition.onerror = (event) => {
      lastError = event.error;
      finish();
    };

    recognition.onend = () => {
      finish();
    };

    signal?.addEventListener(
      "abort",
      () => {
        try {
          recognition.abort();
        } catch {
          // Ignore abort after natural completion
        }
        finish();
      },
      { once: true }
    );

    try {
      recognition.start();
    } catch (err) {
      lastError = err instanceof Error ? err.message : "microphone-start-failed";
      finish();
    }
  });
}
