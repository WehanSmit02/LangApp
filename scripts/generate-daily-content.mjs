import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import {
  discoverCourseIds,
  readJsonFile,
  resolveCurriculumRoot,
  scanAndValidateCurriculum,
  writeManifestAndCourseLedgers,
} from "./lib/curriculum-io.mjs";
import {
  CourseBlueprintSchema,
  CourseDescriptorSchema,
  CourseLexiconLedgerSchema,
  ManifestSchema,
  TIER_META,
  TIER_ORDER,
  TierShardSchema,
  UnitMetaSchema,
  validateShardReadingCapabilities,
} from "../src/schemas/curriculum.ts";

function parseOptions() {
  const args = process.argv.slice(2);
  let targetCourse =
    process.env.INPUT_TARGET_COURSE ||
    process.env.INPUT_LANGUAGE ||
    "all";
  let unitsPerCourse = Number(
    process.env.INPUT_UNITS_PER_COURSE ||
      process.env.INPUT_UNITS_COUNT ||
      "1"
  );
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  for (const arg of args) {
    if (arg.startsWith("--course=") || arg.startsWith("--language=")) {
      targetCourse = arg.split("=")[1];
    } else if (arg.startsWith("--units=")) {
      unitsPerCourse = Number(arg.split("=")[1]);
    }
  }

  if (!Number.isInteger(unitsPerCourse) || unitsPerCourse < 1 || unitsPerCourse > 4) {
    unitsPerCourse = 1;
  }

  return { targetCourse: targetCourse.trim() || "all", unitsPerCourse, model };
}

export async function generateValidatedJson(
  ai,
  model,
  systemInstruction,
  basePrompt,
  validatorFn,
  label
) {
  let feedback = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt = feedback
      ? `${basePrompt}\n\nYour previous JSON failed strict validation:\n${feedback}\nReturn corrected JSON only.`
      : basePrompt;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.35,
      },
    });

    const rawText = response.text?.trim() ?? "";
    try {
      const parsed = JSON.parse(rawText);
      return validatorFn(parsed);
    } catch (err) {
      feedback = err instanceof Error ? err.message : String(err);
      console.warn(`[${label}] Validation attempt ${attempt + 1} failed: ${feedback}`);
    }
  }

  throw new Error(`Failed to generate valid ${label} after 3 attempts.`);
}

export function buildUnitMetaPrompt(descriptor, bpUnit, stage) {
  return `Generate a UnitMeta JSON object for ${descriptor.name} (${descriptor.nativeName}, courseId: "${descriptor.id}") Unit ${bpUnit.unitNumber}:
- unitId: "${bpUnit.unitId}"
- courseId: "${descriptor.id}"
- unitNumber: ${bpUnit.unitNumber}
- stageId: "${bpUnit.stageId}" (${stage.label})
- title: "${bpUnit.title}"
- subtitle: "${bpUnit.subtitle}"
- communicativeGoal: "${bpUnit.communicativeGoal}"
- grammarFocus: "${bpUnit.grammarFocus}"
- culturalNote: "${bpUnit.culturalNote}"
${bpUnit.regionalFocus ? `- regionalFocus: "${bpUnit.regionalFocus}"` : ""}

Exact JSON shape required:
{
  "unitId": "${bpUnit.unitId}",
  "courseId": "${descriptor.id}",
  "unitNumber": ${bpUnit.unitNumber},
  "stageId": "${bpUnit.stageId}",
  "title": "${bpUnit.title}",
  "subtitle": "${bpUnit.subtitle}",
  "summary": "2 concise human sentences explaining what the learner will handle in real life",
  "estimatedMinutes": 35,
  "communicativeCanDo": ["3 concrete real-world can-do outcomes"],
  "culturalInsight": "Authentic cultural note tailored to ${descriptor.name}"
}`;
}

export function buildTierShardPrompt(
  descriptor,
  bpUnit,
  stage,
  tier,
  forbiddenLexiconIds,
  forbiddenGrammarIds
) {
  const tierInfo = TIER_META[tier];
  const prefix = `${descriptor.id}-u${String(bpUnit.unitNumber).padStart(3, "0")}-t${tierInfo.number}`;
  const tierScope =
    descriptor.tierDescriptions?.[tier] ?? tierInfo.defaultDescription;

  const hasRuby = Boolean(descriptor.readingFeatures.rubyAnnotations);
  const requiresRuby = hasRuby && tier !== "fluent";
  const hasCompoundSplitter = Boolean(
    descriptor.readingFeatures.compoundSplitter
  );
  const variantsList = descriptor.variants ?? [];

  const capabilityInstructions = [
    `- Authentic, natural ${descriptor.name} (${descriptor.nativeName}) expressions.`,
    requiresRuby
      ? `- CRITICAL RUBY RULE: Because this course enables "${descriptor.readingFeatures.rubyAnnotations.label}" (<ruby>), EVERY ideograph/Kanji character in gradedStories[].paragraphs[].rubyHtml AND in every gradedStories[].paragraphs[].segments[].rubyHtml MUST be wrapped inside <ruby>BASE<rt>READING</rt></ruby>. Zero bare ideographs outside <ruby> tags.`
      : "",
    hasCompoundSplitter
      ? `- CRITICAL COMPOUND RULE: Because this course enables "${descriptor.readingFeatures.compoundSplitter.label}", include space tokens {"surface": " "} between words in gradedStories[].paragraphs[].segments and include at least 2 multi-root compound words with "compoundParts": ["Root1", "root2"] where compoundParts joined case-insensitively equals surface exactly.`
      : `- In gradedStories[].paragraphs[].segments, tokenize words cleanly (including space tokens {"surface": " "} for space-delimited scripts) and include "meaning" (plus "reading" when helpful) on vocabulary tokens so tapping words opens the inline glossary.`,
    variantsList.length > 0
      ? `- REGIONAL VARIANTS: This course declares variants ${variantsList.map((v) => `${v.id} (${v.label})`).join(", ")}. Populate variantForms / variantAnswers / variantTargets / regionalNote where regional phrasing differs.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `Generate a complete TierShard JSON object for ${descriptor.name}:
- shardId: "${bpUnit.unitId}-${tier}"
- unitId: "${bpUnit.unitId}"
- courseId: "${descriptor.id}"
- tier: "${tier}"
- tierNumber: ${tierInfo.number} (${tierInfo.label})
- Stage: ${stage.label} (${descriptor.proficiencyFramework.name})
- Unit Theme: "${bpUnit.title}" — ${bpUnit.subtitle}
- Communicative Goal: ${bpUnit.communicativeGoal}
- Grammar Focus: ${bpUnit.grammarFocus}
${bpUnit.regionalFocus ? `- Regional Focus: ${bpUnit.regionalFocus}` : ""}

Tier Pedagogical Scope:
${tierScope}

ID Prefix & Uniqueness Rule:
Prefix EVERY ID in this shard with "${prefix}-" (e.g. "${prefix}-lex-01", "${prefix}-gram-01", "${prefix}-step-01", "${prefix}-drill-01", "${prefix}-card-01", "${prefix}-story-01", "${prefix}-q-01", "${prefix}-row-01").
Never reuse any of these existing lexicon IDs: ${JSON.stringify(forbiddenLexiconIds.slice(-140))}
Never reuse any of these existing grammar IDs: ${JSON.stringify(forbiddenGrammarIds.slice(-90))}

Capability & Schema Rules:
${capabilityInstructions}
- Provide 3 lessonSteps, 2 drills (correctAnswer MUST appear in options), 5 srsCards (mark spoken-friendly cards phraseLockEligible: true, with courseId: "${descriptor.id}"), 1 gradedStories (courseId: "${descriptor.id}", 2-3 paragraphs, 3 comprehension questions with valid correctIndex 0..options.length-1), and 1 referenceSheets (courseId: "${descriptor.id}", 3-5 rows).`;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is required to generate curriculum shards."
    );
  }

  const { targetCourse, unitsPerCourse, model } = parseOptions();
  const curriculumRoot = resolveCurriculumRoot();
  const manifestPath = path.join(curriculumRoot, "manifest.json");

  const allCourseIds = await discoverCourseIds(curriculumRoot);
  const selectedCourseIds =
    targetCourse === "all"
      ? allCourseIds
      : allCourseIds.filter((id) => id === targetCourse);

  if (selectedCourseIds.length === 0) {
    throw new Error(
      `Target course "${targetCourse}" not found in ${path.join(curriculumRoot, "courses")} (available: ${allCourseIds.join(", ")})`
    );
  }

  if (!existsSync(manifestPath)) {
    const preScan = await scanAndValidateCurriculum(curriculumRoot);
    if (preScan.errors.length > 0) {
      throw new Error(`Curriculum invalid before generation: ${preScan.errors.join("; ")}`);
    }
    await writeManifestAndCourseLedgers(
      curriculumRoot,
      preScan.manifestCourses,
      preScan.courseLedgers
    );
  }

  const { parsed: rawManifest } = await readJsonFile(manifestPath);
  const manifest = ManifestSchema.parse(rawManifest);

  const ai = new GoogleGenAI({ apiKey });
  const systemInstruction =
    "You are an expert computational linguist and polyglot curriculum author. Output strictly valid JSON conforming to the requested schema with zero markdown fences.";

  let generatedUnitsTotal = 0;

  for (const courseId of selectedCourseIds) {
    const courseDir = path.join(curriculumRoot, "courses", courseId);
    const { parsed: rawDesc } = await readJsonFile(
      path.join(courseDir, "course.json")
    );
    const descriptor = CourseDescriptorSchema.parse(rawDesc);

    const { parsed: rawBp } = await readJsonFile(
      path.join(courseDir, "syllabus-blueprint.json")
    );
    const blueprint = CourseBlueprintSchema.parse(rawBp);

    const ledgerPath = path.join(courseDir, "lexicon-ledger.json");
    const ledger = existsSync(ledgerPath)
      ? CourseLexiconLedgerSchema.parse((await readJsonFile(ledgerPath)).parsed)
      : {
          schemaVersion: 2,
          courseId,
          updatedAt: new Date().toISOString(),
          unitIds: [],
          lexiconIds: [],
          grammarIds: [],
          orthographyItems: [],
        };

    const manifestCourse = manifest.courses.find((c) => c.courseId === courseId);
    const installedByNum = new Map(
      (manifestCourse?.units ?? []).map((u) => [u.unitNumber, u])
    );

    const targets = [];
    for (const bpUnit of blueprint.units) {
      if (targets.length >= unitsPerCourse) break;
      const existing = installedByNum.get(bpUnit.unitNumber);
      if (!existing) {
        targets.push({
          bpUnit,
          needsMeta: true,
          missingTiers: [...TIER_ORDER],
        });
        continue;
      }
      const missingTiers = TIER_ORDER.filter((t) => !existing.shards[t]);
      if (missingTiers.length > 0) {
        targets.push({
          bpUnit,
          needsMeta: false,
          missingTiers,
        });
      }
    }

    if (targets.length === 0) {
      console.log(`[${courseId}] All ${blueprint.units.length} units already complete.`);
      continue;
    }

    const forbiddenLex = [...ledger.lexiconIds];
    const forbiddenGram = [...ledger.grammarIds];

    for (const target of targets) {
      const folderName = `unit-${String(target.bpUnit.unitNumber).padStart(3, "0")}`;
      const unitDir = path.join(courseDir, "units", folderName);
      await mkdir(unitDir, { recursive: true });

      const stage =
        descriptor.proficiencyFramework.stages.find(
          (s) => s.id === target.bpUnit.stageId
        ) ?? descriptor.proficiencyFramework.stages[0];

      if (target.needsMeta) {
        console.log(
          `Generating courses/${courseId}/units/${folderName}/meta.json (${target.bpUnit.title})...`
        );
        const meta = await generateValidatedJson(
          ai,
          model,
          systemInstruction,
          buildUnitMetaPrompt(descriptor, target.bpUnit, stage),
          (data) => UnitMetaSchema.parse(data),
          `${courseId}/${folderName}/meta.json`
        );
        await writeFile(
          path.join(unitDir, "meta.json"),
          `${JSON.stringify(meta, null, 2)}\n`,
          "utf8"
        );
      }

      for (const tier of target.missingTiers) {
        const shardFile = TIER_META[tier].shardFile;
        console.log(`Generating courses/${courseId}/units/${folderName}/${shardFile}...`);
        const shard = await generateValidatedJson(
          ai,
          model,
          systemInstruction,
          buildTierShardPrompt(
            descriptor,
            target.bpUnit,
            stage,
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
          `${courseId}/${folderName}/${shardFile}`
        );

        forbiddenLex.push(...shard.introducedLexiconIds);
        forbiddenGram.push(...shard.introducedGrammarIds);

        await writeFile(
          path.join(unitDir, shardFile),
          `${JSON.stringify(shard, null, 2)}\n`,
          "utf8"
        );
      }
      generatedUnitsTotal += 1;
    }
  }

  if (generatedUnitsTotal === 0) {
    return;
  }

  const postScan = await scanAndValidateCurriculum(curriculumRoot);
  if (postScan.errors.length > 0) {
    throw new Error(
      `Generated shards failed global validation:\n${postScan.errors.join("\n")}`
    );
  }

  await writeManifestAndCourseLedgers(
    curriculumRoot,
    postScan.manifestCourses,
    postScan.courseLedgers
  );
  console.log(
    `Updated manifest.json and course ledgers after generating ${generatedUnitsTotal} unit target(s).`
  );
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith("generate-daily-content.mjs");

if (isDirectExecution) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
