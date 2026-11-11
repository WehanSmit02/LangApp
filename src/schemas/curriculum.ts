import { z } from "zod";

export const CourseIdSchema = z
  .string()
  .min(2)
  .max(24)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/);
export type CourseId = z.infer<typeof CourseIdSchema>;

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
    defaultDescription: string;
  }
> = {
  essential: {
    number: 1,
    label: "Necessary Words",
    shortLabel: "Necessary Words",
    shardFile: "tier-1-essential.json",
    defaultDescription:
      "High-frequency survival phrases, polite greetings, numbers, prices, transit & menu signage, and core script or word-root recognition.",
  },
  travel: {
    number: 2,
    label: "Travel Ready",
    shortLabel: "Travel Ready",
    shardFile: "tier-2-travel.json",
    defaultDescription:
      "Polite sentence builders, counters & quantities, restaurant and café ordering, directions, station transfers, and everyday interactions.",
  },
  conversational: {
    number: 3,
    label: "Conversational",
    shortLabel: "Conversational",
    shardFile: "tier-3-conversational.json",
    defaultDescription:
      "Unscripted social give-and-take: casual and polite registers, past & conditional storytelling, multi-clause connectors, and regional ear-tuning.",
  },
  fluent: {
    number: 4,
    label: "Full Fluency",
    shortLabel: "Full Fluency",
    shardFile: "tier-4-fluent.json",
    defaultDescription:
      "Complete mastery: diplomatic & honorific register, nuanced idioms, abstract and professional topics, and unassisted native readings.",
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

const CJK_IDEOGRAPH_REGEX = /[\u4e00-\u9faf\u3400-\u4dbf]/;
const RUBY_PAIR_REGEX = /<ruby>[^<]+<rt>[^<]+<\/rt><\/ruby>/g;

export function containsIdeographs(text: string): boolean {
  return CJK_IDEOGRAPH_REGEX.test(text);
}

export function hasUnannotatedIdeographs(markup: string): boolean {
  const stripped = markup.replace(RUBY_PAIR_REGEX, "");
  return CJK_IDEOGRAPH_REGEX.test(stripped);
}

export const ProficiencyStageSchema = z.object({
  id: z.string().min(1),
  stageNumber: z.number().int().min(1).max(12).optional(),
  label: z.string().min(1),
  cefrOrJlpt: z.string().optional(),
  summary: z.string().min(1),
  recommendedTier: UnderstandingTierSchema.optional(),
});
export type ProficiencyStage = z.infer<typeof ProficiencyStageSchema>;

export const CourseVariantSchema = z.object({
  id: z.string().min(2),
  label: z.string().min(1),
  ttsLocale: z.string().min(2),
  defaultEnabled: z.boolean().optional(),
  description: z.string().optional(),
});
export type CourseVariant = z.infer<typeof CourseVariantSchema>;

export const FeatureToggleDescriptorSchema = z.object({
  enabledByDefault: z.boolean(),
  label: z.string().min(1),
});
export type FeatureToggleDescriptor = z.infer<
  typeof FeatureToggleDescriptorSchema
>;

export const ReadingFeaturesSchema = z.object({
  rubyAnnotations: FeatureToggleDescriptorSchema.optional(),
  compoundSplitter: FeatureToggleDescriptorSchema.optional(),
  romanizationLine: FeatureToggleDescriptorSchema.optional(),
});
export type ReadingFeatures = z.infer<typeof ReadingFeaturesSchema>;

export const ScriptGridCellSchema = z.object({
  symbol: z.string().min(1),
  sublabel: z.string().min(1),
  tts: z.string().min(1),
  sampleWord: z.string().optional(),
  sampleMeaning: z.string().optional(),
});
export type ScriptGridCell = z.infer<typeof ScriptGridCellSchema>;

export const ScriptGridSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  columns: z.number().int().min(2).max(12),
  cells: z.array(ScriptGridCellSchema.nullable()).min(1),
});
export type ScriptGrid = z.infer<typeof ScriptGridSchema>;

export const CourseDescriptorSchema = z.object({
  id: CourseIdSchema,
  name: z.string().min(1),
  nativeName: z.string().min(1),
  summary: z.string().min(1),
  textDirection: z.enum(["ltr", "rtl"]),
  ttsLocales: z.array(z.string().min(2)).min(1),
  sttLocale: z.string().min(2),
  tierDescriptions: z
    .object({
      essential: z.string().min(1),
      travel: z.string().min(1),
      conversational: z.string().min(1),
      fluent: z.string().min(1),
    })
    .optional(),
  proficiencyFramework: z.object({
    name: z.string().min(1),
    stages: z.array(ProficiencyStageSchema).min(1),
  }),
  variants: z.array(CourseVariantSchema).optional(),
  readingFeatures: ReadingFeaturesSchema,
  scriptGrids: z.array(ScriptGridSchema).optional(),
});
export type CourseDescriptor = z.infer<typeof CourseDescriptorSchema>;

export const VariantExpressionSchema = z.object({
  nativeText: z.string().min(1),
  romanization: z.string().optional(),
  note: z.string().optional(),
});
export type VariantExpression = z.infer<typeof VariantExpressionSchema>;

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
  variantForms: z.record(z.string(), VariantExpressionSchema).optional(),
  regionalNote: z.string().optional(),
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
  variantAnswers: z.record(z.string(), z.string().min(1)).optional(),
  explanation: z.string().min(1),
});
export type Drill = z.infer<typeof DrillSchema>;

export const SrsCardSchema = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1),
  courseId: CourseIdSchema,
  tier: UnderstandingTierSchema,
  frontPrompt: z.string().min(1),
  targetText: z.string().min(1),
  rubyHtml: z.string().optional(),
  reading: z.string().optional(),
  contextSentence: z.string().min(1),
  contextRubyHtml: z.string().optional(),
  contextTranslation: z.string().min(1),
  compoundParts: z.array(z.string().min(1)).min(2).optional(),
  variantTargets: z.record(z.string(), z.string().min(1)).optional(),
  regionalNote: z.string().optional(),
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

export const GradedStorySchema = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1),
  courseId: CourseIdSchema,
  tier: UnderstandingTierSchema,
  title: z.string().min(1),
  titleTranslation: z.string().min(1),
  setting: z.string().min(1),
  paragraphs: z.array(StoryParagraphSchema).min(2),
  questions: z.array(StoryQuestionSchema).length(3),
});
export type GradedStory = z.infer<typeof GradedStorySchema>;

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
  category: z.string().min(1),
  courseId: CourseIdSchema,
  tier: UnderstandingTierSchema,
  title: z.string().min(1),
  subtitle: z.string().min(1),
  rows: z.array(ReferenceRowSchema).min(2),
});
export type ReferenceSheet = z.infer<typeof ReferenceSheetSchema>;

export const TierShardSchema = z.object({
  shardId: z.string().min(1),
  unitId: z.string().min(1),
  courseId: CourseIdSchema,
  tier: UnderstandingTierSchema,
  tierNumber: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  focusSummary: z.string().min(1),
  introducedLexiconIds: z.array(z.string().min(1)).min(1),
  introducedOrthography: z.array(z.string().min(1)).optional(),
  introducedGrammarIds: z.array(z.string().min(1)),
  lessonSteps: z.array(LessonStepSchema).min(2),
  drills: z.array(DrillSchema).min(2),
  srsCards: z.array(SrsCardSchema).min(4),
  gradedStories: z.array(GradedStorySchema).min(1),
  referenceSheets: z.array(ReferenceSheetSchema),
});
export type TierShard = z.infer<typeof TierShardSchema>;

export function validateShardReadingCapabilities(
  shard: TierShard,
  descriptor: CourseDescriptor
): string[] {
  const issues: string[] = [];
  const needsRubyCheck =
    Boolean(descriptor.readingFeatures.rubyAnnotations) &&
    shard.tier !== "fluent";
  const needsCompoundCheck = Boolean(
    descriptor.readingFeatures.compoundSplitter
  );

  shard.gradedStories.forEach((story, sIdx) => {
    if (needsRubyCheck) {
      story.paragraphs.forEach((paragraph, pIdx) => {
        if (containsIdeographs(paragraph.nativeText)) {
          if (
            !paragraph.rubyHtml ||
            !paragraph.rubyHtml.includes("<ruby>") ||
            hasUnannotatedIdeographs(paragraph.rubyHtml)
          ) {
            issues.push(
              `Story "${story.id}" paragraph ${pIdx + 1} requires complete <ruby> annotations for all ideographs in Tiers 1-3.`
            );
          }
        }
        paragraph.segments.forEach((seg, tokIdx) => {
          if (containsIdeographs(seg.surface)) {
            if (!seg.rubyHtml || hasUnannotatedIdeographs(seg.rubyHtml)) {
              issues.push(
                `Story "${story.id}" paragraph ${pIdx + 1} token #${tokIdx + 1} ("${seg.surface}") requires complete <ruby> markup.`
              );
            }
          }
        });
      });
    }

    if (needsCompoundCheck) {
      let compoundCount = 0;
      story.paragraphs.forEach((paragraph, pIdx) => {
        paragraph.segments.forEach((seg) => {
          if (seg.compoundParts && seg.compoundParts.length >= 2) {
            compoundCount += 1;
            const joined = seg.compoundParts.join("").toLowerCase();
            const cleanSurface = seg.surface
              .replace(/[.,!?;:"„“»«()]/g, "")
              .toLowerCase();
            if (joined !== cleanSurface) {
              issues.push(
                `Story "${story.id}" paragraph ${pIdx + 1}: compoundParts [${seg.compoundParts.join(", ")}] must join to match "${cleanSurface}".`
              );
            }
          }
        });
      });
      if (compoundCount === 0) {
        issues.push(
          `Story #${sIdx + 1} ("${story.id}") in compoundSplitter course "${descriptor.id}" must include at least one root-split compound word.`
        );
      }
    }
  });

  return issues;
}

export const UnitMetaSchema = z.object({
  unitId: z.string().min(1),
  courseId: CourseIdSchema,
  unitNumber: z.number().int().min(1).max(200),
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

export const ManifestUnitEntrySchema = z.object({
  unitId: z.string().min(1),
  unitNumber: z.number().int().min(1).max(200),
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

export const ManifestCourseEntrySchema = z.object({
  courseId: CourseIdSchema,
  version: z.number().int().positive(),
  courseDescriptorPath: z.string().min(1),
  blueprintPath: z.string().min(1),
  unitCount: z.number().int().nonnegative(),
  totalPlannedUnits: z.number().int().positive(),
  descriptor: CourseDescriptorSchema.omit({ scriptGrids: true }).extend({
    hasScriptGrids: z.boolean(),
  }),
  units: z.array(ManifestUnitEntrySchema),
});
export type ManifestCourseEntry = z.infer<typeof ManifestCourseEntrySchema>;

export const ManifestSchema = z.object({
  schemaVersion: z.literal(2),
  updatedAt: z.string().min(1),
  courses: z.array(ManifestCourseEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const BlueprintUnitSchema = z.object({
  unitNumber: z.number().int().min(1).max(200),
  unitId: z.string().min(1),
  stageId: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  communicativeGoal: z.string().min(1),
  grammarFocus: z.string().min(1),
  culturalNote: z.string().min(1),
  regionalFocus: z.string().optional(),
});
export type BlueprintUnit = z.infer<typeof BlueprintUnitSchema>;

export const CourseBlueprintSchema = z.object({
  schemaVersion: z.literal(2),
  courseId: CourseIdSchema,
  stages: z.array(ProficiencyStageSchema).min(1),
  units: z.array(BlueprintUnitSchema).min(1),
});
export type CourseBlueprint = z.infer<typeof CourseBlueprintSchema>;

export const CourseLexiconLedgerSchema = z.object({
  schemaVersion: z.literal(2),
  courseId: CourseIdSchema,
  updatedAt: z.string().min(1),
  unitIds: z.array(z.string()),
  lexiconIds: z.array(z.string()),
  grammarIds: z.array(z.string()),
  orthographyItems: z.array(z.string()),
});
export type CourseLexiconLedger = z.infer<typeof CourseLexiconLedgerSchema>;
