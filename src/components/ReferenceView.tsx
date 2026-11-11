import { ArrowUpRight, Search, Volume2, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { KANA_ROWS, type KanaCell } from "../data/kanaChart";
import { speakText } from "../services/speechService";
import type { UserPreferences } from "../state/preferences";
import type { OfflineLibraryHandle } from "../state/useOfflineLibrary";
import { RubyText } from "./ui/RubyText";
import { SegmentedControl } from "./ui/SegmentedControl";

type ReferenceSection = "sheets" | "kana";
type KanaScript = "hiragana" | "katakana";

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
  const [kanaScript, setKanaScript] = useState<KanaScript>("hiragana");
  const [selectedMora, setSelectedMora] = useState<KanaCell>(
    KANA_ROWS[0][0] as KanaCell
  );
  const [query, setQuery] = useState<string>("");

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

  const handlePlayMora = (cell: KanaCell) => {
    setSelectedMora(cell);
    void speakText({
      text: cell.hiragana,
      language: "ja",
      rate: 0.9,
    });
  };

  return (
    <div className="space-y-4">
      <section className="hig-card p-4 sm:p-5 space-y-4">
        <div>
          <h1 className="text-[24px] font-bold leading-tight text-[var(--ink-primary)]">
            Reference
          </h1>
          <p className="mt-1 text-[14px] text-[var(--ink-secondary)]">
            Quick-lookup grammar, regional matrices, compound roots, and the 46-mora Kana soundboard.
          </p>
        </div>

        <SegmentedControl<ReferenceSection>
          id="reference-section-switcher"
          ariaLabel="Reference section"
          value={section}
          onChange={setSection}
          options={[
            { value: "sheets", label: "Field Manual" },
            { value: "kana", label: "Kana Soundboard" },
          ]}
        />
      </section>

      {section === "kana" ? (
        <section aria-label="46-mora Kana soundboard" className="space-y-4">
          <div className="hig-card p-4 sm:p-5 space-y-4">
            <SegmentedControl<KanaScript>
              id="kana-script-switcher"
              ariaLabel="Kana script"
              compact
              value={kanaScript}
              onChange={setKanaScript}
              options={[
                { value: "hiragana", label: "Hiragana (あ)" },
                { value: "katakana", label: "Katakana (ア)" },
              ]}
            />

            <div className="hig-inset p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg-elevated)] text-[28px] font-bold text-[var(--accent)]">
                  {kanaScript === "hiragana"
                    ? selectedMora.hiragana
                    : selectedMora.katakana}
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[var(--ink-primary)]">
                    {selectedMora.romaji} · {selectedMora.sampleWordJa} (
                    {selectedMora.sampleReading})
                  </div>
                  <div className="text-[13px] text-[var(--ink-secondary)]">
                    Example: {selectedMora.sampleMeaning}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  void speakText({
                    text: selectedMora.sampleWordJa,
                    language: "ja",
                    rate: 0.92,
                  })
                }
                aria-label="Hear example word"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-white shrink-0"
              >
                <Volume2 className="h-4 w-4" strokeWidth={2} />
                <span>Word</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {KANA_ROWS.map((row, rowIdx) => (
                <div key={rowIdx} className="grid grid-cols-5 gap-1.5">
                  {row.map((cell, colIdx) => {
                    if (!cell) {
                      return (
                        <div
                          key={`empty-${rowIdx}-${colIdx}`}
                          aria-hidden="true"
                          className="min-h-[52px]"
                        />
                      );
                    }
                    const isSelected = selectedMora.romaji === cell.romaji;
                    const glyph =
                      kanaScript === "hiragana" ? cell.hiragana : cell.katakana;
                    return (
                      <motion.button
                        key={cell.romaji}
                        id={`kana-cell-${cell.romaji}`}
                        type="button"
                        whileTap={
                          prefersReducedMotion ? undefined : { scale: 0.96 }
                        }
                        onClick={() => handlePlayMora(cell)}
                        className={`flex min-h-[54px] flex-col items-center justify-center rounded-xl transition-colors ${
                          isSelected
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--bg-inset)] text-[var(--ink-primary)] hover:opacity-90"
                        }`}
                      >
                        <span className="text-[20px] font-bold leading-none">
                          {glyph}
                        </span>
                        <span
                          className={`mt-1 text-[11px] font-medium ${
                            isSelected
                              ? "text-white/85"
                              : "text-[var(--ink-secondary)]"
                          }`}
                        >
                          {cell.romaji}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              ))}
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
              placeholder="Search particles, counters, Austrian words, roots..."
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
                Download Unit 1 in Japanese or German to populate Core Particles, Konbini Clerk Decoder, and the Austrian vs. Standard German Matrix.
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
              {filteredSheets.map((sheet) => (
                <article
                  key={sheet.id}
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
                      {sheet.language === "ja"
                        ? "Japanese"
                        : prefs.austrianMode
                        ? "Austrian / DE"
                        : "German"}
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
                            language: sheet.language,
                            austrianMode: prefs.austrianMode,
                            rate: 0.95,
                          })
                        }
                        className="flex w-full items-start justify-between gap-3 py-3 text-left hover:opacity-90 transition-opacity min-w-0"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-[16px] font-semibold text-[var(--ink-primary)] break-words">
                              {sheet.language === "ja" ? (
                                <RubyText
                                  rubyHtml={row.rubyHtml}
                                  fallbackText={row.term}
                                  showFurigana={prefs.showFurigana}
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

                          <div className="text-[14px] text-[var(--ink-primary)] break-words">
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
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
