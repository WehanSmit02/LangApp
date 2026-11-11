import { ArrowUpRight, Search, Volume2, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import type {
  CourseDescriptor,
  CourseId,
  ScriptGrid,
  ScriptGridCell,
} from "../schemas/curriculum";
import {
  resolveCourseSpeechLocales,
  speakText,
} from "../services/speechService";
import {
  getOrderedEnrolledCourses,
  type UserPreferences,
} from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import { resolveCourseDisplayName } from "../utils/formatters";
import { CourseSwitcher } from "./ui/CourseSwitcher";
import { RubyText } from "./ui/RubyText";
import { SegmentedControl } from "./ui/SegmentedControl";

type ReferenceSection = "sheets" | "soundboards";

export function ReferenceView({
  prefs,
  library,
  onNavigateCourses,
}: {
  prefs: UserPreferences;
  library: OfflineLibraryHandle;
  onNavigateCourses: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [section, setSection] = useState<ReferenceSection>("sheets");
  const [selectedGridCourseId, setSelectedGridCourseId] = useState<string>("");
  const [selectedGridId, setSelectedGridId] = useState<string>("");
  const [selectedCell, setSelectedCell] = useState<ScriptGridCell | null>(null);
  const [query, setQuery] = useState<string>("");

  const activeEnrollments = useMemo(
    () => getOrderedEnrolledCourses(prefs.enrolledCourses, "active"),
    [prefs.enrolledCourses]
  );

  const coursesWithGrids = useMemo(() => {
    const items: Array<{
      courseId: CourseId;
      descriptor: CourseDescriptor;
      grids: ScriptGrid[];
    }> = [];
    for (const enrollment of activeEnrollments) {
      const desc = library.descriptorsByCourseId.get(enrollment.courseId);
      if (desc?.scriptGrids && desc.scriptGrids.length > 0) {
        items.push({
          courseId: enrollment.courseId,
          descriptor: desc,
          grids: desc.scriptGrids,
        });
      }
    }
    return items;
  }, [activeEnrollments, library.descriptorsByCourseId]);

  const activeGridCourse =
    coursesWithGrids.find((c) => c.courseId === selectedGridCourseId) ??
    coursesWithGrids[0] ??
    null;

  const activeGrid: ScriptGrid | null = useMemo(() => {
    if (!activeGridCourse) return null;
    return (
      activeGridCourse.grids.find((g) => g.id === selectedGridId) ??
      activeGridCourse.grids[0] ??
      null
    );
  }, [activeGridCourse, selectedGridId]);

  const firstNonNullCell = useMemo(
    () =>
      activeGrid?.cells.find((c): c is ScriptGridCell => c !== null) ?? null,
    [activeGrid]
  );

  const previewCell: ScriptGridCell | null = useMemo(() => {
    if (!activeGrid) return null;
    if (
      selectedCell &&
      activeGrid.cells.some((c) => c?.symbol === selectedCell.symbol)
    ) {
      return selectedCell;
    }
    return firstNonNullCell;
  }, [activeGrid, selectedCell, firstNonNullCell]);

  const filteredSheets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library.aggregatedReferenceSheets;

    return library.aggregatedReferenceSheets
      .map((sheet) => {
        const sheetMatches =
          sheet.title.toLowerCase().includes(q) ||
          sheet.subtitle.toLowerCase().includes(q);
        const matchingRows = sheetMatches
          ? sheet.rows
          : sheet.rows.filter(
              (r) =>
                r.term.toLowerCase().includes(q) ||
                (r.readingOrSubtle ?? "").toLowerCase().includes(q) ||
                r.meaning.toLowerCase().includes(q) ||
                r.exampleNative.toLowerCase().includes(q) ||
                r.exampleTranslation.toLowerCase().includes(q)
            );
        return { ...sheet, rows: matchingRows };
      })
      .filter((sheet) => sheet.rows.length > 0);
  }, [library.aggregatedReferenceSheets, query]);

  const handlePlayGridCell = (
    cell: ScriptGridCell,
    courseId: CourseId,
    descriptor: CourseDescriptor
  ) => {
    setSelectedCell(cell);
    const locales = resolveCourseSpeechLocales(
      descriptor,
      prefs.enrolledCourses[courseId]?.activeVariantId
    );
    void speakText({
      text: cell.tts,
      locales: locales.ttsLocales,
      rate: 0.9,
    });
  };

  const effectiveSection: ReferenceSection =
    section === "soundboards" && coursesWithGrids.length === 0
      ? "sheets"
      : section;

  const soundboardTabLabel =
    coursesWithGrids.length === 1
      ? `${coursesWithGrids[0].descriptor.name} Soundboard`
      : "Soundboards";

  return (
    <div className="space-y-4">
      <section className="hig-card p-4 sm:p-5 space-y-4">
        <div>
          <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
            Reference
          </h1>
          <p className="mt-1 text-[14px] text-[var(--ink-secondary)]">
            Quick-lookup grammar, regional matrices, word roots, and interactive
            character soundboards.
          </p>
        </div>

        {coursesWithGrids.length > 0 && (
          <SegmentedControl<ReferenceSection>
            id="reference-section-switcher"
            ariaLabel="Reference section"
            value={effectiveSection}
            onChange={setSection}
            options={[
              { value: "sheets", label: "Field Manual" },
              { value: "soundboards", label: soundboardTabLabel },
            ]}
          />
        )}
      </section>

      {effectiveSection === "soundboards" &&
      activeGridCourse &&
      activeGrid ? (
        <section aria-label="Character soundboard" className="space-y-4">
          <div className="hig-card p-4 sm:p-5 space-y-4">
            {coursesWithGrids.length > 1 && (
              <CourseSwitcher<string>
                id="soundboard-course-switcher"
                ariaLabel="Select course soundboard"
                compact
                value={activeGridCourse.courseId}
                onChange={(nextId) => {
                  setSelectedGridCourseId(nextId);
                  setSelectedGridId("");
                  setSelectedCell(null);
                }}
                options={coursesWithGrids.map((c) => ({
                  value: c.courseId,
                  label: c.descriptor.name,
                  textLabel: c.descriptor.name,
                }))}
              />
            )}

            {activeGridCourse.grids.length > 1 && (
              <SegmentedControl<string>
                id="script-grid-switcher"
                ariaLabel="Select script chart"
                compact
                value={activeGrid.id}
                onChange={(nextGridId) => {
                  setSelectedGridId(nextGridId);
                  setSelectedCell(null);
                }}
                options={activeGridCourse.grids.map((g) => ({
                  value: g.id,
                  label: g.label,
                }))}
              />
            )}

            {previewCell && (
              <div className="hig-inset p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    dir={activeGridCourse.descriptor.textDirection}
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg-elevated)] text-[28px] font-bold text-[var(--accent)]"
                  >
                    {previewCell.symbol}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-[var(--ink-primary)] truncate">
                      {previewCell.sublabel}
                      {previewCell.sampleWord
                        ? ` · ${previewCell.sampleWord}`
                        : ""}
                    </div>
                    <div className="text-[13px] text-[var(--ink-secondary)] truncate">
                      {previewCell.sampleMeaning
                        ? `Example: ${previewCell.sampleMeaning}`
                        : `Tap any character to hear pronunciation`}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const locales = resolveCourseSpeechLocales(
                      activeGridCourse.descriptor,
                      prefs.enrolledCourses[activeGridCourse.courseId]
                        ?.activeVariantId
                    );
                    void speakText({
                      text: previewCell.sampleWord ?? previewCell.tts,
                      locales: locales.ttsLocales,
                      rate: 0.92,
                    });
                  }}
                  aria-label="Hear character or example word"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-white shrink-0"
                >
                  <Volume2 className="h-4 w-4" strokeWidth={2} />
                  <span>{previewCell.sampleWord ? "Word" : "Listen"}</span>
                </button>
              </div>
            )}

            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${activeGrid.columns}, minmax(0, 1fr))`,
              }}
            >
              {activeGrid.cells.map((cell, idx) => {
                if (!cell) {
                  return (
                    <div
                      key={`empty-${idx}`}
                      aria-hidden="true"
                      className="min-h-[52px]"
                    />
                  );
                }
                const isSelected = previewCell?.symbol === cell.symbol;
                return (
                  <motion.button
                    key={`${activeGrid.id}-${cell.symbol}-${idx}`}
                    type="button"
                    whileTap={
                      prefersReducedMotion ? undefined : { scale: 0.96 }
                    }
                    onClick={() =>
                      handlePlayGridCell(
                        cell,
                        activeGridCourse.courseId,
                        activeGridCourse.descriptor
                      )
                    }
                    className={`flex min-h-[54px] flex-col items-center justify-center rounded-xl transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--bg-inset)] text-[var(--ink-primary)] hover:opacity-90"
                    }`}
                  >
                    <span
                      dir={activeGridCourse.descriptor.textDirection}
                      className="text-[20px] font-bold leading-none"
                    >
                      {cell.symbol}
                    </span>
                    <span
                      className={`mt-1 text-[11px] font-medium truncate max-w-full px-1 ${
                        isSelected
                          ? "text-white/85"
                          : "text-[var(--ink-secondary)]"
                      }`}
                    >
                      {cell.sublabel}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <section aria-label="Field reference sheets" className="space-y-4">
          <div className="hig-card p-3 flex items-center gap-2.5">
            <Search
              className="ml-1.5 h-4 w-4 shrink-0 text-[var(--ink-secondary)]"
              strokeWidth={1.9}
            />
            <input
              id="reference-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search grammar patterns, regional expressions, roots..."
              className="min-h-[38px] w-full min-w-0 bg-transparent text-[15px] placeholder:text-[var(--ink-secondary)] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full bg-[var(--bg-pill)] text-[var(--ink-secondary)]"
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            )}
          </div>

          {library.aggregatedReferenceSheets.length === 0 ? (
            <div className="hig-card p-6 text-center space-y-4">
              <h2 className="text-[18px] font-semibold text-[var(--ink-primary)]">
                Reference sheets sync with your units
              </h2>
              <p className="mx-auto max-w-md text-[14px] leading-relaxed text-[var(--ink-secondary)]">
                Download Unit 1 in Courses to populate grammar cheat-sheets,
                survival decoders, and regional phrase tables offline.
              </p>
              <button
                id="reference-empty-courses-cta"
                type="button"
                onClick={onNavigateCourses}
                className="inline-flex min-h-[46px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 text-[14px] font-semibold text-white"
              >
                <span>Open Courses</span>
                <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          ) : filteredSheets.length === 0 ? (
            <div className="hig-card p-6 text-center text-[14px] text-[var(--ink-secondary)]">
              No reference entries match “{query}”.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSheets.map((sheet) => {
                const sheetDescriptor = library.descriptorsByCourseId.get(
                  sheet.courseId
                );
                const sheetEnrollment = prefs.enrolledCourses[sheet.courseId];
                const sheetLocales = resolveCourseSpeechLocales(
                  sheetDescriptor,
                  sheetEnrollment?.activeVariantId
                );
                const sheetCourseLabel = resolveCourseDisplayName(
                  sheet.courseId,
                  sheetDescriptor,
                  sheetEnrollment?.activeVariantId
                );
                const sheetDir = sheetDescriptor?.textDirection ?? "ltr";

                return (
                  <article
                    key={`${sheet.courseId}:${sheet.id}`}
                    className="hig-card p-4 sm:p-5 space-y-3 min-w-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="text-[17px] font-semibold text-[var(--ink-primary)]">
                          {sheet.title}
                        </h2>
                        <p className="text-[13px] text-[var(--ink-secondary)]">
                          {sheet.subtitle}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--bg-pill)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink-secondary)]">
                        {sheetCourseLabel}
                      </span>
                    </div>

                    <div className="divide-y divide-[var(--hairline)]">
                      {sheet.rows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() =>
                            void speakText({
                              text: row.exampleNative,
                              locales: sheetLocales.ttsLocales,
                              rate: 0.95,
                            })
                          }
                          className="flex w-full items-start justify-between gap-3 py-3 text-left hover:opacity-90 transition-opacity min-w-0"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span
                                dir={sheetDir}
                                className="text-[16px] font-semibold text-[var(--ink-primary)] break-words"
                              >
                                {sheetDescriptor?.readingFeatures
                                  .rubyAnnotations && row.rubyHtml ? (
                                  <RubyText
                                    rubyHtml={row.rubyHtml}
                                    fallbackText={row.term}
                                    showFurigana={
                                      sheetEnrollment?.showRubyAnnotations ??
                                      true
                                    }
                                  />
                                ) : (
                                  row.term
                                )}
                              </span>
                              {row.readingOrSubtle && (
                                <span className="text-[13px] text-[var(--ink-secondary)] break-words">
                                  {row.readingOrSubtle}
                                </span>
                              )}
                              <span className="text-[13px] font-medium text-[var(--accent)]">
                                {row.meaning}
                              </span>
                            </div>

                            <div
                              dir={sheetDir}
                              className="text-[14px] text-[var(--ink-primary)] break-words"
                            >
                              {row.exampleNative}
                            </div>
                            <div className="text-[12px] text-[var(--ink-secondary)]">
                              {row.exampleTranslation}
                              {row.notes ? ` · ${row.notes}` : ""}
                            </div>
                          </div>

                          <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-inset)] text-[var(--accent)]">
                            <Volume2 className="h-4 w-4" strokeWidth={1.9} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
