import { z } from "zod";

export const LanguageCodeSchema = z.enum(["ja", "de"]);
export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

export const UnderstandingTierSchema = z.enum([
  "essential",
  "travel",
  "conversational",
  "fluent",
]);
export type UnderstandingTier = z.infer<typeof UnderstandingTierSchema>;

export const TIER_ORDER: readonly UnderstandingTier[] = [
  "essential",
  "travel",
  "conversational",
  "fluent",
] as const;

export const TIER_META: Record<
  UnderstandingTier,
  {
    number: 1 | 2 | 3 | 4;
    label: string;
    shortLabel: string;
    shardFile: string;
    descriptionJa: string;
    descriptionDe: string;
  }
> = {
  essential: {
    number: 1,
    label: "Necessary Words",
    shortLabel: "Necessary Words",
    shardFile: "tier-1-essential.json",
    descriptionJa:
      "Survival phrases, polite greetings, numbers, prices, menu & station signs, and Hiragana/Katakana recognition.",
    descriptionDe:
      "Polite Austrian & German greetings, numbers, signs, café & transit essentials, and compound-word root splitting.",
  },
  travel: {
    number: 2,
    label: "Travel Ready",
    shortLabel: "Travel Ready",
    shardFile: "tier-2-travel.json",
    descriptionJa:
      "Adds Desu/Masu sentence builders, counters, izakaya & restaurant ordering, directions, konbini interactions, and survival Kanji.",
    descriptionDe:
      "Adds polite requests (Ich hätte gern...), Kaffeehaus & Beisl ordering, ÖBB rail transfers, hotel check-in, and practical phrases.",
  },
  conversational: {
    number: 3,
    label: "Conversational",
    shortLabel: "Conversational",
    shardFile: "tier-3-conversational.json",
    descriptionJa:
      "Unscripted social give-and-take (~JLPT N4–N3): plain/casual forms, past & conditional storytelling, multi-clause connectors, and 400+ Kanji.",
    descriptionDe:
      "Natural conversation (~CEFR B1): Perfekt storytelling, subordinate connectors (weil, obwohl), everyday banter, and Austrian ear-tuning.",
  },
  fluent: {
    number: 4,
    label: "Full Fluency",
    shortLabel: "Full Fluency",
    shardFile: "tier-4-fluent.json",
    descriptionJa:
      "Complete mastery (JLPT N1): honorific Keigo, nuanced idioms, 2,136 Jōyō Kanji, professional register, and unassisted native readings.",
    descriptionDe:
      "Complete mastery (CEFR C1): Konjunktiv II diplomacy, participial structures, regional idioms, abstract discourse, and native prose.",
  },
};

export function tiersUpTo(target: UnderstandingTier): UnderstandingTier[] {
  const targetIdx = TIER_ORDER.indexOf(target);
  return TIER_ORDER.slice(0, targetIdx + 1);
}

export function isTierIncluded(
  itemTier: UnderstandingTier,
  userTargetTier: UnderstandingTier
): boolean {
  return TIER_ORDER.indexOf(itemTier) <= TIER_ORDER.indexOf(userTargetTier);
}

const KANJI_REGEX = /[\u4e00-\u9faf\u3400-\u4dbf]/;
const RUBY_PAIR_REGEX = /<ruby>[^<]+<rt>[^<]+<\/rt><\/ruby>/g;

export function hasUnannotatedKanji(markup: string): boolean {
  const stripped = markup.replace(RUBY_PAIR_REGEX, "");
  return KANJI_REGEX.test(stripped);
}

export const RegionalVariantSchema = z.object({
  nativeText: z.string().min(1),
  note: z.string().min(1),
});
export type RegionalVariant = z.infer<typeof RegionalVariantSchema>;

export const LessonStepSchema = z.object({
  id: z.string().min(1),
  tier: UnderstandingTierSchema,
  heading: z.string().min(1),
  explanation: z.string().min(1),
  scenarioPrompt: z.string().min(1),
  nativeText: z.string().min(1),
  rubyHtml: z.string().optional(),
  romanization: z.string().optional(),
  translation: z.string().min(1),
  literalBreakdown: z.string().optional(),
  standardGermanVariant: RegionalVariantSchema.optional(),
  compoundParts: z.array(z.string().min(1)).min(2).optional(),
  usageTip: z.string().optional(),
});
export type LessonStep = z.infer<typeof LessonStepSchema>;

export const DrillSchema = z.object({
  id: z.string().min(1),
  tier: UnderstandingTierSchema,
  prompt: z.string().min(1),
  baseSentence: z.string().optional(),
  cue: z.string().min(1),
  options: z.array(z.string().min(1)).min(3).max(4),
  correctAnswer: z.string().min(1),
  acceptedVariants: z.array(z.string().min(1)).optional(),
  standardGermanAnswer: z.string().optional(),
  explanation: z.string().min(1),
});
export type Drill = z.infer<typeof DrillSchema>;

export const SrsCardSchema = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1),
  language: LanguageCodeSchema,
  tier: UnderstandingTierSchema,
  frontPrompt: z.string().min(1),
  targetText: z.string().min(1),
  rubyHtml: z.string().optional(),
  reading: z.string().optional(),
  contextSentence: z.string().min(1),
  contextRubyHtml: z.string().optional(),
  contextTranslation: z.string().min(1),
  compoundParts: z.array(z.string().min(1)).min(2).optional(),
  austrianNote: z.string().optional(),
  standardGermanText: z.string().optional(),
  phraseLockEligible: z.boolean(),
});
export type SrsCard = z.infer<typeof SrsCardSchema>;

export const StoryTokenSchema = z.object({
  surface: z.string().min(1),
  rubyHtml: z.string().optional(),
  reading: z.string().optional(),
  meaning: z.string().optional(),
  compoundParts: z.array(z.string().min(1)).min(2).optional(),
  regionalNote: z.string().optional(),
});
export type StoryToken = z.infer<typeof StoryTokenSchema>;

export const StoryParagraphSchema = z.object({
  nativeText: z.string().min(1),
  rubyHtml: z.string().optional(),
  translation: z.string().min(1),
  segments: z.array(StoryTokenSchema).min(1),
});
export type StoryParagraph = z.infer<typeof StoryParagraphSchema>;

export const StoryQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(3).max(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
});
export type StoryQuestion = z.infer<typeof StoryQuestionSchema>;

export const GradedStorySchema = z
  .object({
    id: z.string().min(1),
    unitId: z.string().min(1),
    language: LanguageCodeSchema,
    tier: UnderstandingTierSchema,
    title: z.string().min(1),
    titleTranslation: z.string().min(1),
    setting: z.string().min(1),
    paragraphs: z.array(StoryParagraphSchema).min(2),
    questions: z.array(StoryQuestionSchema).length(3),
  })
  .superRefine((story, ctx) => {
    const requiresFurigana =
      story.language === "ja" && story.tier !== "fluent";

    if (requiresFurigana) {
      story.paragraphs.forEach((paragraph, pIdx) => {
        if (KANJI_REGEX.test(paragraph.nativeText)) {
          if (!paragraph.rubyHtml || !paragraph.rubyHtml.includes("<ruby>")) {
            ctx.addIssue({
              code: "custom",
              path: ["paragraphs", pIdx, "rubyHtml"],
              message:
                "Japanese stories in Tiers 1-3 must include <ruby> markup whenever Kanji appears.",
            });
          } else if (hasUnannotatedKanji(paragraph.rubyHtml)) {
            ctx.addIssue({
              code: "custom",
              path: ["paragraphs", pIdx, "rubyHtml"],
              message:
                "Every Kanji character in Japanese Tiers 1-3 rubyHtml must be wrapped inside <ruby>...<rt>...</rt></ruby>.",
            });
          }
        }

        paragraph.segments.forEach((seg, sIdx) => {
          if (KANJI_REGEX.test(seg.surface)) {
            if (!seg.rubyHtml || hasUnannotatedKanji(seg.rubyHtml)) {
              ctx.addIssue({
                code: "custom",
                path: ["paragraphs", pIdx, "segments", sIdx, "rubyHtml"],
                message: `Token "${seg.surface}" contains Kanji and requires complete <ruby> markup in Tiers 1-3.`,
              });
            }
          }
        });
      });
    }

    if (story.language === "de") {
      let compoundCount = 0;
      story.paragraphs.forEach((paragraph, pIdx) => {
        paragraph.segments.forEach((seg, sIdx) => {
          if (seg.compoundParts && seg.compoundParts.length >= 2) {
            compoundCount += 1;
            const joined = seg.compoundParts.join("").toLowerCase();
            const cleanSurface = seg.surface
              .replace(/[.,!?;:"„“»«()]/g, "")
              .toLowerCase();
            if (joined !== cleanSurface) {
              ctx.addIssue({
                code: "custom",
                path: ["paragraphs", pIdx, "segments", sIdx, "compoundParts"],
                message: `Compound parts [${seg.compoundParts.join(", ")}] must join to match "${cleanSurface}".`,
              });
            }
          }
        });
      });

      if (compoundCount === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["paragraphs"],
          message:
            "German stories must include at least one compound word with root-split compoundParts.",
        });
      }
    }
  });
export type GradedStory = z.infer<typeof GradedStorySchema>;

export const ReferenceCategorySchema = z.enum([
  "particles",
  "counters",
  "konbini",
  "austrian-matrix",
  "lego-roots",
  "polite-patterns",
  "transit-dining",
  "idioms-register",
]);
export type ReferenceCategory = z.infer<typeof ReferenceCategorySchema>;

export const ReferenceRowSchema = z.object({
  id: z.string().min(1),
  term: z.string().min(1),
  rubyHtml: z.string().optional(),
  readingOrSubtle: z.string().optional(),
  meaning: z.string().min(1),
  exampleNative: z.string().min(1),
  exampleTranslation: z.string().min(1),
  notes: z.string().optional(),
});
export type ReferenceRow = z.infer<typeof ReferenceRowSchema>;

export const ReferenceSheetSchema = z.object({
  id: z.string().min(1),
  category: ReferenceCategorySchema,
  language: LanguageCodeSchema,
  tier: UnderstandingTierSchema,
  title: z.string().min(1),
  subtitle: z.string().min(1),
  rows: z.array(ReferenceRowSchema).min(2),
});
export type ReferenceSheet = z.infer<typeof ReferenceSheetSchema>;

export const TierShardSchema = z.object({
  shardId: z.string().min(1),
  unitId: z.string().min(1),
  language: LanguageCodeSchema,
  tier: UnderstandingTierSchema,
  tierNumber: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  focusSummary: z.string().min(1),
  introducedLexiconIds: z.array(z.string().min(1)).min(1),
  introducedKanji: z.array(z.string().min(1)).optional(),
  introducedRoots: z.array(z.string().min(1)).optional(),
  introducedGrammarIds: z.array(z.string().min(1)),
  lessonSteps: z.array(LessonStepSchema).min(2),
  drills: z.array(DrillSchema).min(2),
  srsCards: z.array(SrsCardSchema).min(4),
  gradedStories: z.array(GradedStorySchema).min(1),
  referenceSheets: z.array(ReferenceSheetSchema),
});
export type TierShard = z.infer<typeof TierShardSchema>;

export const UnitMetaSchema = z.object({
  unitId: z.string().min(1),
  language: LanguageCodeSchema,
  unitNumber: z.number().int().min(1).max(60),
  stageId: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  summary: z.string().min(1),
  estimatedMinutes: z.number().int().min(10).max(120),
  communicativeCanDo: z.array(z.string().min(1)).min(2),
  culturalInsight: z.string().min(1),
});
export type UnitMeta = z.infer<typeof UnitMetaSchema>;

export const ShardDescriptorSchema = z.object({
  file: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  cardCount: z.number().int().nonnegative(),
  stepCount: z.number().int().nonnegative(),
});
export type ShardDescriptor = z.infer<typeof ShardDescriptorSchema>;

export const StageInfoSchema = z.object({
  id: z.string().min(1),
  stageNumber: z.number().int().min(1).max(6),
  label: z.string().min(1),
  cefrOrJlpt: z.string().min(1),
  summary: z.string().min(1),
  recommendedTier: UnderstandingTierSchema,
});
export type StageInfo = z.infer<typeof StageInfoSchema>;

export const ManifestUnitEntrySchema = z.object({
  unitId: z.string().min(1),
  unitNumber: z.number().int().min(1).max(60),
  directory: z.string().min(1),
  stageId: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  estimatedMinutes: z.number().int().positive(),
  shards: z.object({
    essential: ShardDescriptorSchema.optional(),
    travel: ShardDescriptorSchema.optional(),
    conversational: ShardDescriptorSchema.optional(),
    fluent: ShardDescriptorSchema.optional(),
  }),
});
export type ManifestUnitEntry = z.infer<typeof ManifestUnitEntrySchema>;

export const LanguageManifestSchema = z.object({
  language: LanguageCodeSchema,
  title: z.string().min(1),
  stages: z.array(StageInfoSchema).length(6),
  units: z.array(ManifestUnitEntrySchema),
});
export type LanguageManifest = z.infer<typeof LanguageManifestSchema>;

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().min(1),
  languages: z.object({
    ja: LanguageManifestSchema,
    de: LanguageManifestSchema,
  }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const BlueprintUnitSchema = z.object({
  unitNumber: z.number().int().min(1).max(60),
  unitId: z.string().min(1),
  stageId: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  communicativeGoal: z.string().min(1),
  grammarFocus: z.string().min(1),
  culturalNote: z.string().min(1),
  austrianFocus: z.string().optional(),
});
export type BlueprintUnit = z.infer<typeof BlueprintUnitSchema>;

export const SyllabusBlueprintSchema = z.object({
  schemaVersion: z.literal(1),
  languages: z.object({
    ja: z.object({
      stages: z.array(StageInfoSchema).length(6),
      units: z.array(BlueprintUnitSchema).length(60),
    }),
    de: z.object({
      stages: z.array(StageInfoSchema).length(6),
      units: z.array(BlueprintUnitSchema).length(60),
    }),
  }),
});
export type SyllabusBlueprint = z.infer<typeof SyllabusBlueprintSchema>;

export const LedgerLanguageBucketSchema = z.object({
  unitIds: z.array(z.string()),
  lexiconIds: z.array(z.string()),
  grammarIds: z.array(z.string()),
  kanjiOrRoots: z.array(z.string()),
});
export type LedgerLanguageBucket = z.infer<typeof LedgerLanguageBucketSchema>;

export const LexiconLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().min(1),
  languages: z.object({
    ja: LedgerLanguageBucketSchema,
    de: LedgerLanguageBucketSchema,
  }),
});
export type LexiconLedger = z.infer<typeof LexiconLedgerSchema>;
