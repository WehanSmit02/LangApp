import { Check, Copy, RefreshCw, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { BRAND } from "../config/brand";
import type {
  ThemePreference,
  UserPreferences,
} from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import { formatBytesHuman } from "../utils/formatters";
import { resolveTransition, SHEET_SPRING } from "../utils/motionPresets";
import { SegmentedControl } from "./ui/SegmentedControl";
import { SwitchToggle } from "./ui/SwitchToggle";

const SHORTCUT_APP_PRESETS = [
  { label: "Instagram", scheme: "instagram://" },
  { label: "YouTube", scheme: "youtube://" },
  { label: "TikTok", scheme: "snssdk1233://" },
  { label: "X", scheme: "twitter://" },
  { label: "Reddit", scheme: "reddit://" },
] as const;

export function SettingsSheet({
  prefs,
  updatePrefs,
  library,
  onClose,
}: {
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
  const sheetTransition = resolveTransition(prefersReducedMotion, SHEET_SPRING);

  const [shortcutPresetIdx, setShortcutPresetIdx] = useState<number>(0);
  const [copiedShortcut, setCopiedShortcut] = useState<boolean>(false);
  const [repoDraft, setRepoDraft] = useState<string>(
    prefs.customCurriculumRepo
  );

  const chosenShortcut = SHORTCUT_APP_PRESETS[shortcutPresetIdx];
  const buildShortcutUrl = () => {
    const origin =
      typeof window !== "undefined"
        ? `${window.location.origin}${import.meta.env.BASE_URL || "/"}`
        : `https://${BRAND.defaultRepoOwner.toLowerCase()}.github.io/${BRAND.defaultRepoName}/`;
    const url = new URL(origin);
    url.searchParams.set("lock", "1");
    url.searchParams.set("app", chosenShortcut.label);
    url.searchParams.set("scheme", chosenShortcut.scheme);
    return url.toString();
  };

  const handleCopyShortcutUrl = async () => {
    const url = buildShortcutUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopiedShortcut(true);
      window.setTimeout(() => setCopiedShortcut(false), 2200);
    } catch {
      // Clipboard blocked on insecure contexts
    }
  };

  const handleSaveCustomRepo = () => {
    updatePrefs({ customCurriculumRepo: repoDraft.trim() });
    void library.refreshCatalog();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-sheet-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 backdrop-blur-xs"
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
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-t-[26px] sm:rounded-[26px] bg-[var(--bg-canvas)] px-5 pt-3 pb-8 pb-safe shadow-2xl space-y-5"
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20 sm:hidden" />

        <div className="flex items-center justify-between">
          <h2
            id="settings-sheet-title"
            className="text-[20px] font-bold text-[var(--ink-primary)]"
          >
            Settings
          </h2>
          <button
            id="settings-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-5 w-5" strokeWidth={1.9} />
          </button>
        </div>

        <section className="hig-card p-4 space-y-3">
          <h3 className="text-[15px] font-semibold">Appearance</h3>
          <SegmentedControl<ThemePreference>
            id="settings-theme-control"
            ariaLabel="Appearance theme"
            compact
            value={prefs.theme}
            onChange={(next) => updatePrefs({ theme: next })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </section>

        <section className="hig-card divide-y divide-[var(--hairline)] px-4">
          <div className="py-3.5 space-y-2">
            <div className="flex items-center justify-between text-[14px] font-medium tabular-nums">
              <span>Weekly Language Split</span>
              <span>
                {prefs.japaneseSplitPercent}% JP /{" "}
                {Number((100 - prefs.japaneseSplitPercent).toFixed(1))}% DE
              </span>
            </div>
            <input
              id="settings-split-slider"
              type="range"
              min={0}
              max={100}
              step={2.5}
              value={prefs.japaneseSplitPercent}
              onChange={(e) =>
                updatePrefs({ japaneseSplitPercent: Number(e.target.value) })
              }
              className="w-full accent-[var(--accent)]"
            />
          </div>

          <div className="py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-medium">
                Focus Session Duration
              </div>
              <div className="text-[12px] text-[var(--ink-secondary)]">
                Default timer block on Today
              </div>
            </div>
            <select
              value={prefs.focusSessionMinutes}
              onChange={(e) =>
                updatePrefs({ focusSessionMinutes: Number(e.target.value) })
              }
              className="min-h-[40px] rounded-xl bg-[var(--bg-inset)] px-3 text-[14px] font-medium tabular-nums"
            >
              <option value={25}>25 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
            </select>
          </div>

          <div className="py-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2">
              <span className="block text-[12px] text-[var(--ink-secondary)]">
                Japan Goal Date
              </span>
              <input
                type="date"
                value={prefs.goalDates.ja}
                onChange={(e) =>
                  updatePrefs((prev) => ({
                    ...prev,
                    goalDates: { ...prev.goalDates, ja: e.target.value },
                  }))
                }
                className="mt-0.5 w-full bg-transparent text-[14px] font-medium"
              />
            </label>
            <label className="block rounded-xl bg-[var(--bg-inset)] px-3 py-2">
              <span className="block text-[12px] text-[var(--ink-secondary)]">
                {prefs.austrianMode ? "Austria" : "Germany"} Goal Date
              </span>
              <input
                type="date"
                value={prefs.goalDates.de}
                onChange={(e) =>
                  updatePrefs((prev) => ({
                    ...prev,
                    goalDates: { ...prev.goalDates, de: e.target.value },
                  }))
                }
                className="mt-0.5 w-full bg-transparent text-[14px] font-medium"
              />
            </label>
          </div>
        </section>

        <section className="hig-card divide-y divide-[var(--hairline)] px-4">
          <div className="py-3.5 space-y-2.5">
            <div className="text-[15px] font-semibold">
              Phrase Lock Automation
            </div>
            <div className="space-y-1.5">
              <div className="text-[13px] text-[var(--ink-secondary)]">
                Required Speech Accuracy
              </div>
              <SegmentedControl<"60" | "75" | "90">
                id="settings-lock-accuracy"
                ariaLabel="Phrase Lock speech accuracy"
                compact
                value={String(prefs.phraseLockAccuracy) as "60" | "75" | "90"}
                onChange={(val) =>
                  updatePrefs({
                    phraseLockAccuracy: Number(val) as 60 | 75 | 90,
                  })
                }
                options={[
                  { value: "60", label: "60% Relaxed" },
                  { value: "75", label: "75% Balanced" },
                  { value: "90", label: "90% Strict" },
                ]}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[14px] font-medium">Unlock Window</span>
              <select
                value={prefs.phraseLockDurationMinutes}
                onChange={(e) =>
                  updatePrefs({
                    phraseLockDurationMinutes: Number(e.target.value),
                  })
                }
                className="min-h-[40px] rounded-xl bg-[var(--bg-inset)] px-3 text-[14px] font-medium tabular-nums"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </div>
          </div>

          <div className="py-3.5 space-y-2.5">
            <div className="text-[14px] font-medium">
              iOS Shortcuts App Shield Helper
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--ink-secondary)]">
              Create a Personal Automation in iOS Shortcuts (“When app is opened → Open URLs”) using this link:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SHORTCUT_APP_PRESETS.map((preset, idx) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setShortcutPresetIdx(idx)}
                  className={`min-h-[36px] rounded-full px-3 text-[12px] font-medium ${
                    idx === shortcutPresetIdx
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--bg-inset)] text-[var(--ink-secondary)]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              id="settings-copy-shortcut-url"
              type="button"
              onClick={() => void handleCopyShortcutUrl()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--bg-inset)] px-4 text-[14px] font-semibold text-[var(--accent)]"
            >
              {copiedShortcut ? (
                <>
                  <Check className="h-4 w-4" strokeWidth={2} />
                  <span>Copied {chosenShortcut.label} Lock URL</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" strokeWidth={1.9} />
                  <span>Copy iOS Shortcuts URL ({chosenShortcut.label})</span>
                </>
              )}
            </button>
          </div>
        </section>

        <section className="hig-card divide-y divide-[var(--hairline)] px-4">
          <div className="py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-medium">
                Auto-download next 2 units on Wi-Fi
              </div>
              <div className="text-[12px] text-[var(--ink-secondary)]">
                Prefetches upcoming shards matching your goal tier
              </div>
            </div>
            <SwitchToggle
              id="settings-wifi-autodownload"
              checked={prefs.autoDownloadWifi}
              onChange={(next) => updatePrefs({ autoDownloadWifi: next })}
              ariaLabel="Auto-download next 2 units on Wi-Fi"
            />
          </div>

          <div className="py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-medium">Offline Storage</div>
              <div className="text-[12px] text-[var(--ink-secondary)] tabular-nums">
                {formatBytesHuman(library.totalStorageBytes)} across{" "}
                {library.installedMetas.length} installed{" "}
                {library.installedMetas.length === 1 ? "unit" : "units"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void library.refreshCatalog()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--bg-inset)] px-3.5 text-[13px] font-medium text-[var(--ink-primary)]"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>Check Updates</span>
            </button>
          </div>

          <div className="py-3.5 space-y-2">
            <label
              htmlFor="settings-custom-repo-input"
              className="block text-[13px] font-medium text-[var(--ink-secondary)]"
            >
              Custom Curriculum Repository Override (Optional)
            </label>
            <div className="flex gap-2">
              <input
                id="settings-custom-repo-input"
                type="text"
                value={repoDraft}
                onChange={(e) => setRepoDraft(e.target.value)}
                placeholder={`${BRAND.defaultRepoOwner}/${BRAND.defaultRepoName}`}
                className="min-h-[42px] flex-1 min-w-0 rounded-xl bg-[var(--bg-inset)] px-3 text-[13px] font-mono text-[var(--ink-primary)] placeholder:text-[var(--ink-secondary)]"
              />
              <button
                type="button"
                onClick={handleSaveCustomRepo}
                className="min-h-[42px] shrink-0 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </section>

        <footer className="px-2 text-center text-[12px] text-[var(--ink-secondary)]">
          {BRAND.appName} · Release 1.0 · Offline-first adaptive curriculum
        </footer>
      </motion.div>
    </div>
  );
}
