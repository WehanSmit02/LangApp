import { useSyncExternalStore } from "react";
import { BRAND } from "../config/brand";
import type {
  CourseDescriptor,
  CourseId,
  ManifestCourseEntry,
  UnderstandingTier,
} from "../schemas/curriculum";
import {
  type CurriculumRepoConfig,
  DEFAULT_REPO_CONFIG,
} from "../services/githubRepoSync";

export type ThemePreference = "system" | "light" | "dark";
export type CourseEnrollmentStatus = "active" | "paused";

export interface EnrolledCourseConfig {
  courseId: CourseId;
  status: CourseEnrollmentStatus;
  tier: UnderstandingTier;
  weightPercent: number;
  activeVariantId?: string;
  goalDate: string;
  showRubyAnnotations: boolean;
  showCompoundDividers: boolean;
  showRomanization: boolean;
}

export interface UserPreferences {
  onboardingCompleted: boolean;
  enrolledCourses: Record<CourseId, EnrolledCourseConfig>;
  activeCourseTab: CourseId;
  rebalanceLocked: boolean;
  focusSessionsPerDay: number;
  focusSessionMinutes: number;
  dailyPracticeMinutes: number;
  autoDownloadWifi: boolean;
  repoConfig: CurriculumRepoConfig;
  theme: ThemePreference;
  storySpeechRate: 0.8 | 1.0;
  phraseLockAccuracy: 60 | 75 | 90;
  phraseLockDurationMinutes: number;
  unlockExpiryMs: number;
}

const PREFS_KEY = `${BRAND.storagePrefix}settings_v2`;
const UNLOCK_KEY = `${BRAND.storagePrefix}unlock_expiry_ms`;

export const DEFAULT_PREFERENCES: UserPreferences = {
  onboardingCompleted: false,
  enrolledCourses: {},
  activeCourseTab: "",
  rebalanceLocked: true,
  focusSessionsPerDay: 3,
  focusSessionMinutes: 60,
  dailyPracticeMinutes: 50,
  autoDownloadWifi: true,
  repoConfig: DEFAULT_REPO_CONFIG,
  theme: "system",
  storySpeechRate: 1.0,
  phraseLockAccuracy: 75,
  phraseLockDurationMinutes: 15,
  unlockExpiryMs: 0,
};

export function createEnrollmentFromDescriptor(
  descriptor: Pick<
    CourseDescriptor,
    "id" | "variants" | "readingFeatures" | "proficiencyFramework"
  >,
  options?: {
    tier?: UnderstandingTier;
    weightPercent?: number;
    status?: CourseEnrollmentStatus;
  }
): EnrolledCourseConfig {
  const defaultVariant =
    descriptor.variants?.find((v) => v.defaultEnabled) ??
    descriptor.variants?.[0];

  return {
    courseId: descriptor.id,
    status: options?.status ?? "active",
    tier: options?.tier ?? "conversational",
    weightPercent: options?.weightPercent ?? 100,
    activeVariantId: defaultVariant?.id,
    goalDate: "",
    showRubyAnnotations:
      descriptor.readingFeatures.rubyAnnotations?.enabledByDefault ?? true,
    showCompoundDividers:
      descriptor.readingFeatures.compoundSplitter?.enabledByDefault ?? true,
    showRomanization:
      descriptor.readingFeatures.romanizationLine?.enabledByDefault ?? true,
  };
}

export function buildInitialEnrollmentFromManifest(
  courses: ManifestCourseEntry[]
): Record<CourseId, EnrolledCourseConfig> {
  if (courses.length === 0) return {};
  if (courses.length === 1) {
    const first = courses[0];
    return {
      [first.courseId]: createEnrollmentFromDescriptor(first.descriptor, {
        tier: "conversational",
        weightPercent: 100,
      }),
    };
  }

  const primary = courses[0];
  const secondary = courses[1];
  return {
    [primary.courseId]: createEnrollmentFromDescriptor(primary.descriptor, {
      tier: "conversational",
      weightPercent: 92.5,
    }),
    [secondary.courseId]: createEnrollmentFromDescriptor(secondary.descriptor, {
      tier: "essential",
      weightPercent: 7.5,
    }),
  };
}

export function getOrderedEnrolledCourses(
  enrolledCourses: Record<CourseId, EnrolledCourseConfig>,
  filterStatus?: CourseEnrollmentStatus
): EnrolledCourseConfig[] {
  const list = Object.values(enrolledCourses);
  const filtered = filterStatus
    ? list.filter((c) => c.status === filterStatus)
    : list;
  return filtered.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "active" ? -1 : 1;
    }
    if (b.weightPercent !== a.weightPercent) {
      return b.weightPercent - a.weightPercent;
    }
    return a.courseId.localeCompare(b.courseId);
  });
}

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
      : (parsed.unlockExpiryMs ?? 0);

    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      enrolledCourses: parsed.enrolledCourses ?? {},
      repoConfig: {
        ...DEFAULT_REPO_CONFIG,
        ...(parsed.repoConfig ?? {}),
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
