import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import {
  buildTierShardPrompt,
  buildUnitMetaPrompt,
  generateValidatedJson,
} from "./generate-daily-content.mjs";
import {
  resolveCurriculumRoot,
  scanAndValidateCurriculum,
  writeManifestAndCourseLedgers,
} from "./lib/curriculum-io.mjs";
import {
  CourseBlueprintSchema,
  CourseDescriptorSchema,
  CourseIdSchema,
  TIER_META,
  TIER_ORDER,
  TierShardSchema,
  UnitMetaSchema,
  validateShardReadingCapabilities,
} from "../src/schemas/curriculum.ts";

function parseCliOptions() {
  const args = process.argv.slice(2);
  let id = process.env.INPUT_COURSE_ID || "";
  let name = process.env.INPUT_COURSE_NAME || "";
  let variantsRaw = process.env.INPUT_REGIONAL_VARIANTS || "";
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id" && args[i + 1]) {
      id = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--id=")) {
      id = arg.slice("--id=".length);
    } else if (arg === "--name" && args[i + 1]) {
      name = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
    } else if (arg === "--variants" && args[i + 1]) {
      variantsRaw = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--variants=")) {
      variantsRaw = arg.slice("--variants=".length);
    }
  }

  const courseId = CourseIdSchema.parse(id.trim());
  const courseName = name.trim();
  if (!courseName) {
    throw new Error(
      "Missing --name <Language Name> (e.g., `npm run curriculum:add-language -- --id ko --name Korean`)."
    );
  }

  const variantCodes = variantsRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return { courseId, courseName, variantCodes, model };
}

function buildDescriptorPrompt(courseId, courseName, variantCodes) {
  return `Generate a complete CourseDescriptor JSON object for bootstrapping "${courseName}" (id: "${courseId}") in an adaptive language-learning PWA:
- id: "${courseId}"
- name: "${courseName}"
- nativeName: Authentic endonym in native script
- summary: Concise 1-sentence zero-to-fluency course summary
- textDirection: "ltr" or "rtl"
- ttsLocales: Ordered BCP-47 fallback array (e.g. ["ko-KR"] or ["es-MX", "es-ES"])
- sttLocale: Primary BCP-47 speech recognition locale
- tierDescriptions: Concrete 1-sentence learner scope for "essential", "travel", "conversational", and "fluent"
- proficiencyFramework: Official standard for ${courseName} (e.g., TOPIK, CEFR, HSK, JLPT, ACTFL) with 6 progressive stages ("${courseId}-stage-1" through "${courseId}-stage-6") spanning survival zero to full C1/native mastery
${
  variantCodes.length > 0
    ? `- variants: Include regional variants for [${variantCodes.join(", ")}] with id, human label, ttsLocale, defaultEnabled (true on first), and description`
    : `- variants: Optional array (include if ${courseName} has major standard regional variants or omit if single standard)`
}
- readingFeatures:
  - Set rubyAnnotations ({ enabledByDefault: true, label: "..." }) ONLY if the script uses ideographs needing phonetic ruby (like Japanese Furigana or Chinese Pinyin).
  - Set compoundSplitter ({ enabledByDefault: true, label: "Compound Dots" }) ONLY if the language regularly forms long closedorthographic compound nouns (like German, Dutch, Swedish, Finnish).
  - Set romanizationLine ({ enabledByDefault: true, label: "..." }) if non-Latin script benefits from romanization (e.g., Revised Romanization for Korean, Pinyin, Romaji, Transliteration).
- scriptGrids: If ${courseName} uses a non-Latin script or distinct character/diacritic inventory (e.g., Hangul jamo/syllables, Cyrillic, Arabic, Greek, Hiragana/Katakana, Spanish/French accented letters), provide 1 or 2 interactive soundboard grids (columns between 4 and 8; each cell { symbol, sublabel, tts, sampleWord, sampleMeaning } or null for spacer).`;
}

function buildBlueprintPrompt(descriptor) {
  const stageList = descriptor.proficiencyFramework.stages
    .map((s) => `- "${s.id}": ${s.label} (${s.summary})`)
    .join("\n");

  return `Generate a complete 60-unit zero-to-fluency CourseBlueprint JSON object for ${descriptor.name} (courseId: "${descriptor.id}"):
- schemaVersion: 2
- courseId: "${descriptor.id}"
- stages: Must match these exact 6 stages:
${stageList}
- units: Exactly 60 ordered units (unitNumber 1..60, unitId "${descriptor.id}-unit-001" .. "${descriptor.id}-unit-060", 10 units per stage from "${descriptor.id}-stage-1" to "${descriptor.id}-stage-6").
Each unit requires: unitNumber, unitId, stageId, title, subtitle, communicativeGoal, grammarFocus, culturalNote${
    descriptor.variants?.length ? ", regionalFocus" : ""
  }.`;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is required to bootstrap a new language course."
    );
  }

  const { courseId, courseName, variantCodes, model } = parseCliOptions();
  const curriculumRoot = resolveCurriculumRoot();
  const courseDir = path.join(curriculumRoot, "courses", courseId);

  if (existsSync(path.join(courseDir, "course.json"))) {
    throw new Error(
      `Course "${courseId}" already exists at courses/${courseId}/course.json.`
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const systemInstruction =
    "You are an expert computational linguist and polyglot curriculum architect. Output strictly valid JSON conforming to the requested schema with zero markdown fences.";

  console.log(`Bootstrapping CourseDescriptor for ${courseName} (${courseId})...`);
  const descriptor = await generateValidatedJson(
    ai,
    model,
    systemInstruction,
    buildDescriptorPrompt(courseId, courseName, variantCodes),
    (data) => {
      const parsed = CourseDescriptorSchema.parse(data);
      if (parsed.id !== courseId) {
        throw new Error(`Expected descriptor.id "${courseId}", received "${parsed.id}"`);
      }
      return parsed;
    },
    `courses/${courseId}/course.json`
  );

  console.log(`Generating 60-unit zero-to-fluency blueprint for ${courseName}...`);
  const blueprint = await generateValidatedJson(
    ai,
    model,
    systemInstruction,
    buildBlueprintPrompt(descriptor),
    (data) => {
      const parsed = CourseBlueprintSchema.parse(data);
      if (parsed.units.length !== 60) {
        throw new Error(`Expected 60 units in syllabus-blueprint.json, got ${parsed.units.length}`);
      }
      return parsed;
    },
    `courses/${courseId}/syllabus-blueprint.json`
  );

  const unit1Dir = path.join(courseDir, "units", "unit-001");
  await mkdir(unit1Dir, { recursive: true });
  await writeFile(
    path.join(courseDir, "course.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(courseDir, "syllabus-blueprint.json"),
    `${JSON.stringify(blueprint, null, 2)}\n`,
    "utf8"
  );

  const unit1Bp = blueprint.units[0];
  const stage1 =
    descriptor.proficiencyFramework.stages.find(
      (s) => s.id === unit1Bp.stageId
    ) ?? descriptor.proficiencyFramework.stages[0];

  console.log(`Generating Starter Unit 001 metadata for ${courseName}...`);
  const meta = await generateValidatedJson(
    ai,
    model,
    systemInstruction,
    buildUnitMetaPrompt(descriptor, unit1Bp, stage1),
    (data) => UnitMetaSchema.parse(data),
    `courses/${courseId}/units/unit-001/meta.json`
  );
  await writeFile(
    path.join(unit1Dir, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8"
  );

  const forbiddenLex = [];
  const forbiddenGram = [];

  for (const tier of TIER_ORDER) {
    const shardFile = TIER_META[tier].shardFile;
    console.log(`Generating courses/${courseId}/units/unit-001/${shardFile}...`);
    const shard = await generateValidatedJson(
      ai,
      model,
      systemInstruction,
      buildTierShardPrompt(
        descriptor,
        unit1Bp,
        stage1,
        tier,
        forbiddenLex,
        forbiddenGram
      ),
      (data) => {
        const parsedShard = TierShardSchema.parse(data);
        const capIssues = validateShardReadingCapabilities(
          parsedShard,
          descriptor
        );
        if (capIssues.length > 0) {
          throw new Error(capIssues.join("; "));
        }
        return parsedShard;
      },
      `courses/${courseId}/units/unit-001/${shardFile}`
    );

    forbiddenLex.push(...shard.introducedLexiconIds);
    forbiddenGram.push(...shard.introducedGrammarIds);

    await writeFile(
      path.join(unit1Dir, shardFile),
      `${JSON.stringify(shard, null, 2)}\n`,
      "utf8"
    );
  }

  const scan = await scanAndValidateCurriculum(curriculumRoot);
  if (scan.errors.length > 0) {
    throw new Error(
      `New course "${courseId}" failed curriculum validation:\n${scan.errors.join("\n")}`
    );
  }

  await writeManifestAndCourseLedgers(
    curriculumRoot,
    scan.manifestCourses,
    scan.courseLedgers
  );
  console.log(
    `Registered ${courseName} (${courseId}) with 60-unit blueprint and Starter Unit 001 shards into manifest.json.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
