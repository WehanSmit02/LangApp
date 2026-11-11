import { useSyncExternalStore } from "react";
import { BRAND } from "../config/brand";
import type { LanguageCode, UnderstandingTier } from "../schemas/curriculum";

export type ThemePreference = "system" | "light" | "dark";

export interface UserPreferences {
  onboardingCompleted: boolean;
  tiers: Record<LanguageCode, UnderstandingTier>;
  austrianMode: boolean;
  japaneseSplitPercent: number;
  focusSessionsPerDay: number;
  focusSessionMinutes: number;
  dailyPracticeMinutes: number;
  goalDates: {
    ja: string;
    de: string;
  };
  autoDownloadWifi: boolean;
  customCurriculumRepo: string;
  theme: ThemePreference;
  showFurigana: boolean;
  showCompoundDividers: boolean;
  storySpeechRate: 0.8 | 1.0;
  phraseLockAccuracy: 60 | 75 | 90;
  phraseLockDurationMinutes: number;
  unlockExpiryMs: number;
}

const PREFS_KEY = `${BRAND.storagePrefix}settings_v1`;
const UNLOCK_KEY = `${BRAND.storagePrefix}unlock_expiry_ms`;

export const DEFAULT_PREFERENCES: UserPreferences = {
  onboardingCompleted: false,
  tiers: {
    ja: "conversational",
    de: "essential",
  },
  austrianMode: true,
  japaneseSplitPercent: 92.5,
  focusSessionsPerDay: 3,
  focusSessionMinutes: 60,
  dailyPracticeMinutes: 50,
  goalDates: {
    ja: "",
    de: "",
  },
  autoDownloadWifi: true,
  customCurriculumRepo: "",
  theme: "system",
  showFurigana: true,
  showCompoundDividers: true,
  storySpeechRate: 1.0,
  phraseLockAccuracy: 75,
  phraseLockDurationMinutes: 15,
  unlockExpiryMs: 0,
};

function readInitialPreferences(): UserPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const rawUnlock = window.localStorage.getItem(UNLOCK_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<UserPreferences>) : {};
    const unlockExpiryMs = rawUnlock
      ? Number(rawUnlock) || 0
      : parsed.unlockExpiryMs ?? 0;

    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      tiers: {
        ...DEFAULT_PREFERENCES.tiers,
        ...(parsed.tiers ?? {}),
      },
      goalDates: {
        ...DEFAULT_PREFERENCES.goalDates,
        ...(parsed.goalDates ?? {}),
      },
      unlockExpiryMs,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

let currentPreferences: UserPreferences = readInitialPreferences();
const subscribers = new Set<() => void>();

function applyDocumentTheme(theme: ThemePreference): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
}

applyDocumentTheme(currentPreferences.theme);

if (typeof window !== "undefined") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (currentPreferences.theme === "system") {
        applyDocumentTheme("system");
      }
    });
}

export function getPreferences(): UserPreferences {
  return currentPreferences;
}

export function updatePreferences(
  updater:
    | Partial<UserPreferences>
    | ((prev: UserPreferences) => UserPreferences)
): UserPreferences {
  const next =
    typeof updater === "function"
      ? updater(currentPreferences)
      : { ...currentPreferences, ...updater };

  currentPreferences = next;

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      window.localStorage.setItem(UNLOCK_KEY, String(next.unlockExpiryMs));
    } catch {
      // Private browsing quota blocks storage writes on some mobile WebViews
    }
  }

  applyDocumentTheme(next.theme);
  for (const listener of subscribers) {
    listener();
  }
  return next;
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function usePreferences(): [
  UserPreferences,
  (
    updater:
      | Partial<UserPreferences>
      | ((prev: UserPreferences) => UserPreferences)
  ) => void,
] {
  const snapshot = useSyncExternalStore(
    subscribe,
    getPreferences,
    () => DEFAULT_PREFERENCES
  );
  return [snapshot, updatePreferences];
}
