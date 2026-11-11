import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import {
  BLUEPRINT_PATH,
  CURRICULUM_DIR,
  LEDGER_PATH,
  MANIFEST_PATH,
  readJsonFile,
  scanAndValidateCurriculum,
  writeManifestAndLedger,
} from "./lib/curriculum-io.mjs";
import {
  LexiconLedgerSchema,
  ManifestSchema,
  SyllabusBlueprintSchema,
  TIER_META,
  TIER_ORDER,
  TierShardSchema,
  UnitMetaSchema,
} from "../src/schemas/curriculum.ts";

function parseOptions() {
  const args = process.argv.slice(2);
  let language = process.env.INPUT_LANGUAGE || "all";
  let unitsCount = Number(process.env.INPUT_UNITS_COUNT || "1");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  for (const arg of args) {
    if (arg.startsWith("--language=")) {
      language = arg.split("=")[1];
    } else if (arg.startsWith("--units=")) {
      unitsCount = Number(arg.split("=")[1]);
    }
  }

  if (!["all", "ja", "de"].includes(language)) {
    throw new Error(`Unsupported language option: ${language}`);
  }
  if (!Number.isInteger(unitsCount) || unitsCount < 1 || unitsCount > 4) {
    unitsCount = 1;
  }

  return { language, unitsCount, model };
}

function selectNextTargets(blueprint, manifest, languageFilter, maxUnits) {
  const langs = languageFilter === "all" ? ["ja", "de"] : [languageFilter];
  const targets = [];

  for (const lang of langs) {
    const installedByNumber = new Map(
      manifest.languages[lang].units.map((u) => [u.unitNumber, u])
    );

    let addedForLang = 0;
    for (const bpUnit of blueprint.languages[lang].units) {
      if (addedForLang >= maxUnits) break;

      const existing = installedByNumber.get(bpUnit.unitNumber);
      if (!existing) {
        targets.push({
          lang,
          blueprintUnit: bpUnit,
          needsMeta: true,
          missingTiers: [...TIER_ORDER],
        });
        addedForLang += 1;
        continue;
      }

      const missingTiers = TIER_ORDER.filter((t) => !existing.shards[t]);
      if (missingTiers.length > 0) {
        targets.push({
          lang,
          blueprintUnit: bpUnit,
          needsMeta: false,
          missingTiers,
        });
        addedForLang += 1;
      }
    }
  }

  return targets;
}

async function generateWithRetry(ai, model, systemPrompt, basePrompt, schemaValidator, label) {
  let feedback = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt = feedback
      ? `${basePrompt}\n\nYour previous JSON failed strict Zod validation:\n${feedback}\nReturn corrected JSON only.`
      : basePrompt;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    });

    const rawText = response.text?.trim() ?? "";
    try {
      const parsed = JSON.parse(rawText);
      return schemaValidator.parse(parsed);
    } catch (err) {
      feedback = err instanceof Error ? err.message : String(err);
      console.warn(`[${label}] Validation attempt ${attempt + 1} failed: ${feedback}`);
    }
  }

  throw new Error(`Failed to generate valid ${label} after 3 attempts.`);
}

function buildMetaPrompt(lang, bpUnit, stage) {
  return `Generate a UnitMeta JSON object for ${lang.toUpperCase()} Unit ${bpUnit.unitNumber}:
- unitId: "${bpUnit.unitId}"
- language: "${lang}"
- unitNumber: ${bpUnit.unitNumber}
- stageId: "${bpUnit.stageId}" (${stage.label})
- title: "${bpUnit.title}"
- subtitle: "${bpUnit.subtitle}"
- communicativeGoal: "${bpUnit.communicativeGoal}"
- grammarFocus: "${bpUnit.grammarFocus}"
- culturalNote: "${bpUnit.culturalNote}"
${bpUnit.austrianFocus ? `- austrianFocus: "${bpUnit.austrianFocus}"` : ""}

Required exact JSON shape:
{
  "unitId": "${bpUnit.unitId}",
  "language": "${lang}",
  "unitNumber": ${bpUnit.unitNumber},
  "stageId": "${bpUnit.stageId}",
  "title": "${bpUnit.title}",
  "subtitle": "${bpUnit.subtitle}",
  "summary": "2 concise human sentences explaining what the learner will handle in real life",
  "estimatedMinutes": 35,
  "communicativeCanDo": ["3 concrete real-world can-do outcomes"],
  "culturalInsight": "Authentic cultural note (for German, highlight Austrian de-AT and Standard de-DE context)"
}`;
}

function buildTierShardPrompt(lang, bpUnit, stage, tier, forbiddenLexiconIds, forbiddenGrammarIds) {
  const tierInfo = TIER_META[tier];
  const prefix = `${lang}-u${String(bpUnit.unitNumber).padStart(3, "0")}-t${tierInfo.number}`;
  const isJa = lang === "ja";
  const requiresRuby = isJa && tier !== "fluent";

  return `Generate a complete TierShard JSON object for:
- shardId: "${bpUnit.unitId}-${tier}"
- unitId: "${bpUnit.unitId}"
- language: "${lang}"
- tier: "${tier}"
- tierNumber: ${tierInfo.number} (${tierInfo.label})
- Stage: ${stage.label} (${stage.cefrOrJlpt})
- Unit Theme: "${bpUnit.title}" — ${bpUnit.subtitle}
- Communicative Goal: ${bpUnit.communicativeGoal}
- Grammar Focus: ${bpUnit.grammarFocus}
${bpUnit.austrianFocus ? `- Austrian Regional Focus (de-AT): ${bpUnit.austrianFocus}` : ""}

Tier Pedagogical Scope:
${isJa ? tierInfo.descriptionJa : tierInfo.descriptionDe}

ID Prefix Rule:
Prefix EVERY ID in this shard with "${prefix}-" (for example "${prefix}-lex-01", "${prefix}-gram-01", "${prefix}-step-01", "${prefix}-drill-01", "${prefix}-card-01", "${prefix}-story-01", "${prefix}-q-01", "${prefix}-row-01").
Never reuse any of these existing lexicon IDs: ${JSON.stringify(forbiddenLexiconIds.slice(-160))}
Never reuse any of these existing grammar IDs: ${JSON.stringify(forbiddenGrammarIds.slice(-100))}

Mandatory Content & Cultural Rules:
${
  isJa
    ? `- Culturally authentic Japanese phrasing.
- ${
        requiresRuby
          ? "CRITICAL: In gradedStories, EVERY Kanji character in paragraph.rubyHtml AND in every segment.rubyHtml MUST be wrapped inside <ruby>漢字<rt>かんじ</rt></ruby>. Zero bare Kanji characters outside <ruby> tags."
          : "Tier 4 fluent story uses natural unassisted native Japanese prose."
      }`
    : `- Prioritize authentic Austrian German (de-AT) phrasing (e.g., Grüß Gott, Sackerl, Bankomat, Erdäpfel, Schlagobers, Verlängerter, Beisl, ÖBB Bahnsteig, Semmel, heuer) where natural, and populate standardGermanVariant / standardGermanText / austrianNote so learners also recognize Standard German (de-DE).
- CRITICAL: In gradedStories, include space tokens {"surface": " "} between words, and include at least 2 German compound words in segments with compoundParts (e.g. "surface": "Hauptbahnhof", "compoundParts": ["Haupt", "bahn", "hof"]) where compoundParts joined case-insensitively equals surface exactly.`
}
- Provide 3 lessonSteps, 2 drills (each drill's correctAnswer MUST exactly match one of its 3-4 options), 5 srsCards (mark spoken-friendly cards phraseLockEligible: true), 1 gradedStories (2-3 paragraphs, 3 comprehension questions with valid correctIndex 0..options.length-1), and 1 referenceSheets (category one of: "particles", "counters", "konbini", "austrian-matrix", "lego-roots", "polite-patterns", "transit-dining", "idioms-register", with 3-5 rows).`;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required to generate daily curriculum shards.");
  }

  const { language, unitsCount, model } = parseOptions();
  const { parsed: rawBlueprint } = await readJsonFile(BLUEPRINT_PATH);
  const blueprint = SyllabusBlueprintSchema.parse(rawBlueprint);

  if (!existsSync(MANIFEST_PATH) || !existsSync(LEDGER_PATH)) {
    const initialScan = await scanAndValidateCurriculum();
    if (initialScan.errors.length > 0) {
      throw new Error(`Existing curriculum invalid: ${initialScan.errors.join("; ")}`);
    }
    await writeManifestAndLedger(initialScan.manifestLanguages, initialScan.ledgerLanguages);
  }

  const { parsed: rawManifest } = await readJsonFile(MANIFEST_PATH);
  const manifest = ManifestSchema.parse(rawManifest);

  const { parsed: rawLedger } = await readJsonFile(LEDGER_PATH);
  const ledger = LexiconLedgerSchema.parse(rawLedger);

  const targets = selectNextTargets(blueprint, manifest, language, unitsCount);
  if (targets.length === 0) {
    console.log("All 60 units across requested languages are already complete.");
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const systemInstruction =
    "You are a senior Japanese (JLPT N5-N1) and Austrian/Standard German (CEFR A1-C1) curriculum linguist. Output strictly valid JSON conforming to the requested schema with zero markdown fences.";

  for (const target of targets) {
    const { lang, blueprintUnit, needsMeta, missingTiers } = target;
    const folderName = `unit-${String(blueprintUnit.unitNumber).padStart(3, "0")}`;
    const unitDir = path.join(CURRICULUM_DIR, lang, folderName);
    await mkdir(unitDir, { recursive: true });

    const stage = blueprint.languages[lang].stages.find(
      (s) => s.id === blueprintUnit.stageId
    );
    if (!stage) {
      throw new Error(`Missing stage ${blueprintUnit.stageId} in blueprint.`);
    }

    if (needsMeta) {
      console.log(`Generating ${lang}/${folderName}/meta.json (${blueprintUnit.title})...`);
      const meta = await generateWithRetry(
        ai,
        model,
        systemInstruction,
        buildMetaPrompt(lang, blueprintUnit, stage),
        UnitMetaSchema,
        `${lang}/${folderName}/meta.json`
      );
      await writeFile(
        path.join(unitDir, "meta.json"),
        `${JSON.stringify(meta, null, 2)}\n`,
        "utf8"
      );
    }

    const forbiddenLex = [...ledger.languages[lang].lexiconIds];
    const forbiddenGram = [...ledger.languages[lang].grammarIds];

    for (const tier of missingTiers) {
      const shardFile = TIER_META[tier].shardFile;
      console.log(`Generating ${lang}/${folderName}/${shardFile}...`);
      const shard = await generateWithRetry(
        ai,
        model,
        systemInstruction,
        buildTierShardPrompt(lang, blueprintUnit, stage, tier, forbiddenLex, forbiddenGram),
        TierShardSchema,
        `${lang}/${folderName}/${shardFile}`
      );

      forbiddenLex.push(...shard.introducedLexiconIds);
      forbiddenGram.push(...shard.introducedGrammarIds);

      await writeFile(
        path.join(unitDir, shardFile),
        `${JSON.stringify(shard, null, 2)}\n`,
        "utf8"
      );
    }
  }

  const postScan = await scanAndValidateCurriculum();
  if (postScan.errors.length > 0) {
    throw new Error(
      `Generated shards failed global curriculum checks:\n${postScan.errors.join("\n")}`
    );
  }

  await writeManifestAndLedger(postScan.manifestLanguages, postScan.ledgerLanguages);
  console.log(`Updated manifest.json and lexicon-ledger.json for ${targets.length} unit target(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
