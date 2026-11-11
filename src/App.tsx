import {
  BookMarked,
  BookOpen,
  Compass,
  Layers,
  Lock,
  Settings,
  SunMedium,
  WifiOff,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import { useMemo, useState } from "react";
import { CoursesView } from "./components/CoursesView";
import { ExploreCoursesSheet } from "./components/ExploreCoursesSheet";
import { OnboardingSheet } from "./components/OnboardingSheet";
import { PhraseLockOverlay } from "./components/PhraseLockOverlay";
import { PracticeView } from "./components/PracticeView";
import { ReferenceView } from "./components/ReferenceView";
import { SettingsSheet } from "./components/SettingsSheet";
import { StoriesView } from "./components/StoriesView";
import { TodayView } from "./components/TodayView";
import { BRAND } from "./config/brand";
import { usePreferences } from "./state/preferences";
import { useOfflineLibrary } from "./state/useOfflineLibrary";
import { resolveTransition, SEGMENT_SPRING } from "./utils/motionPresets";

export type PrimaryTab =
  | "today"
  | "courses"
  | "practice"
  | "stories"
  | "reference";

function parseInitialDeepLink(): {
  locked: boolean;
  app?: string;
  scheme?: string;
} {
  if (typeof window === "undefined") {
    return { locked: false };
  }
  const params = new URLSearchParams(window.location.search);
  const locked = params.get("lock") === "1";
  const app = params.get("app") ?? undefined;
  const scheme = params.get("scheme") ?? undefined;
  return { locked, app, scheme };
}

export function App() {
  const [prefs, updatePrefs] = usePreferences();
  const library = useOfflineLibrary(prefs);
  const prefersReducedMotion = useReducedMotion();
  const navSpring = resolveTransition(prefersReducedMotion, SEGMENT_SPRING);

  const deepLink = useMemo(() => parseInitialDeepLink(), []);

  const [activeTab, setActiveTab] = useState<PrimaryTab>("today");
  const [activeStudioUnitId, setActiveStudioUnitId] = useState<string | null>(
    null
  );
  const [phraseLockOpen, setPhraseLockOpen] = useState<boolean>(
    deepLink.locked
  );
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [exploreCoursesOpen, setExploreCoursesOpen] = useState<boolean>(false);

  const handleOpenUnitFromToday = (unitId: string) => {
    const unitMeta = library.metaByUnitId.get(unitId);
    if (unitMeta) {
      updatePrefs({ activeCourseTab: unitMeta.courseId });
    }
    setActiveStudioUnitId(unitId);
    setActiveTab("courses");
  };

  const navItems: ReadonlyArray<{
    id: PrimaryTab;
    label: string;
    Icon: typeof SunMedium;
    badge?: boolean;
  }> = [
    { id: "today", label: "Today", Icon: SunMedium },
    {
      id: "courses",
      label: "Courses",
      Icon: Compass,
      badge: library.outdatedOrUpgradeUnits.outdatedUnits.length > 0,
    },
    { id: "practice", label: "Practice", Icon: Layers },
    { id: "stories", label: "Stories", Icon: BookOpen },
    { id: "reference", label: "Reference", Icon: BookMarked },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh flex flex-col bg-[var(--bg-canvas)] text-[var(--ink-primary)]">
        <header className="sticky top-0 z-30 hig-blur-bar bg-[var(--bg-chrome)] hig-hairline-b pt-safe">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[19px] font-bold tracking-tight text-[var(--ink-primary)]">
                {BRAND.appName}
              </span>
              {library.isOffline && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-secondary)]">
                  <WifiOff className="h-3 w-3" strokeWidth={1.9} />
                  <span>Offline</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                id="header-phrase-lock-btn"
                type="button"
                onClick={() => setPhraseLockOpen(true)}
                aria-label="Open Phrase Lock"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-primary)] hover:opacity-85 transition-opacity"
              >
                <Lock className="h-[18px] w-[18px]" strokeWidth={1.85} />
              </button>

              <button
                id="header-settings-btn"
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open Settings"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-primary)] hover:opacity-85 transition-opacity"
              >
                <Settings className="h-[18px] w-[18px]" strokeWidth={1.85} />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-28 sm:px-6">
          {activeTab === "today" && (
            <TodayView
              prefs={prefs}
              library={library}
              onNavigateTab={(tab) => {
                setActiveStudioUnitId(null);
                setActiveTab(tab);
              }}
              onOpenUnit={handleOpenUnitFromToday}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}

          {activeTab === "courses" && (
            <CoursesView
              prefs={prefs}
              updatePrefs={updatePrefs}
              library={library}
              activeUnitId={activeStudioUnitId}
              onSelectUnit={setActiveStudioUnitId}
              onOpenExploreCourses={() => setExploreCoursesOpen(true)}
            />
          )}

          {activeTab === "practice" && (
            <PracticeView
              prefs={prefs}
              library={library}
              onNavigateCourses={() => {
                setActiveStudioUnitId(null);
                setActiveTab("courses");
              }}
            />
          )}

          {activeTab === "stories" && (
            <StoriesView
              prefs={prefs}
              updatePrefs={updatePrefs}
              library={library}
              onNavigateCourses={() => {
                setActiveStudioUnitId(null);
                setActiveTab("courses");
              }}
            />
          )}

          {activeTab === "reference" && (
            <ReferenceView
              prefs={prefs}
              library={library}
              onNavigateCourses={() => {
                setActiveStudioUnitId(null);
                setActiveTab("courses");
              }}
            />
          )}
        </main>

        <nav
          aria-label="Primary navigation"
          className="fixed inset-x-0 bottom-0 z-30 hig-blur-bar bg-[var(--bg-tabbar)] hig-hairline-t pb-safe"
        >
          <div className="mx-auto grid max-w-3xl grid-cols-5 px-2 pt-1.5 pb-1.5">
            {navItems.map(({ id, label, Icon, badge }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  id={`nav-tab-${id}`}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (id !== "courses") {
                      setActiveStudioUnitId(null);
                    }
                    setActiveTab(id);
                  }}
                  className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 transition-colors ${
                    active
                      ? "text-[var(--accent)]"
                      : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="bottom-tab-indicator"
                      transition={navSpring}
                      className="absolute inset-x-2 inset-y-0.5 -z-10 rounded-xl bg-[var(--accent-soft)]"
                    />
                  )}
                  <span className="relative">
                    <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.8} />
                    {badge && (
                      <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-[var(--accent)]" />
                    )}
                  </span>
                  <span className="text-[11px] font-medium leading-tight truncate max-w-full">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {!prefs.onboardingCompleted && !phraseLockOpen && (
          <OnboardingSheet
            prefs={prefs}
            updatePrefs={updatePrefs}
            library={library}
            onOpenRepoSettings={() => setSettingsOpen(true)}
          />
        )}

        <AnimatePresence>
          {exploreCoursesOpen && (
            <ExploreCoursesSheet
              key="explore-courses-sheet"
              prefs={prefs}
              updatePrefs={updatePrefs}
              library={library}
              onClose={() => setExploreCoursesOpen(false)}
              onSelectCourseTab={(courseId) => {
                updatePrefs({ activeCourseTab: courseId });
                setActiveStudioUnitId(null);
                setActiveTab("courses");
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phraseLockOpen && (
            <PhraseLockOverlay
              key="phrase-lock-overlay"
              prefs={prefs}
              updatePrefs={updatePrefs}
              library={library}
              targetAppName={deepLink.app}
              targetAppScheme={deepLink.scheme}
              onClose={() => setPhraseLockOpen(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {settingsOpen && (
            <SettingsSheet
              key="settings-sheet"
              prefs={prefs}
              updatePrefs={updatePrefs}
              library={library}
              onOpenExploreCourses={() => {
                setSettingsOpen(false);
                setExploreCoursesOpen(true);
              }}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

export default App;
