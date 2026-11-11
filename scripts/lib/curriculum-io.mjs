import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LexiconLedgerSchema,
  ManifestSchema,
  SyllabusBlueprintSchema,
  TIER_META,
  TIER_ORDER,
  TierShardSchema,
  UnitMetaSchema,
} from "../../src/schemas/curriculum.ts";

export const CURRICULUM_DIR = path.resolve(process.cwd(), "public/curriculum");
export const BLUEPRINT_PATH = path.join(CURRICULUM_DIR, "syllabus-blueprint.json");
export const MANIFEST_PATH = path.join(CURRICULUM_DIR, "manifest.json");
export const LEDGER_PATH = path.join(CURRICULUM_DIR, "lexicon-ledger.json");

const LANGUAGE_TITLES = {
  ja: "Japanese — Kana to JLPT N1",
  de: "German & Austrian — Survival Roots to CEFR C1",
};

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function readJsonFile(filePath) {
  const raw = await readFile(filePath);
  const parsed = JSON.parse(raw.toString("utf8"));
  return { raw, parsed };
}

export async function scanAndValidateCurriculum() {
  if (!existsSync(BLUEPRINT_PATH)) {
    throw new Error(`Missing syllabus blueprint at ${BLUEPRINT_PATH}`);
  }

  const { parsed: rawBlueprint } = await readJsonFile(BLUEPRINT_PATH);
  const blueprint = SyllabusBlueprintSchema.parse(rawBlueprint);

  const errors = [];
  const globalIds = new Map();

  function registerUniqueId(kind, id, origin) {
    const composite = `${kind}:${id}`;
    const existing = globalIds.get(composite);
    if (existing) {
      errors.push(
        `Duplicate ${kind} ID "${id}" in ${origin} (already declared in ${existing})`
      );
    } else {
      globalIds.set(composite, origin);
    }
  }

  const manifestLanguages = {};
  const ledgerLanguages = {};

  for (const lang of ["ja", "de"]) {
    const langDir = path.join(CURRICULUM_DIR, lang);
    const blueprintMap = new Map(
      blueprint.languages[lang].units.map((u) => [u.unitNumber, u])
    );

    const dirEntries = existsSync(langDir)
      ? await readdir(langDir, { withFileTypes: true })
      : [];
    const unitFolders = dirEntries
      .filter((entry) => entry.isDirectory() && /^unit-\d{3}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    const manifestUnits = [];
    const unitIds = [];
    const lexiconSet = new Set();
    const grammarSet = new Set();
    const kanjiOrRootSet = new Set();

    for (const folder of unitFolders) {
      const unitPath = path.join(langDir, folder);
      const metaPath = path.join(unitPath, "meta.json");

      if (!existsSync(metaPath)) {
        errors.push(`Missing meta.json in ${lang}/${folder}`);
        continue;
      }

      let unitMeta;
      try {
        const { parsed } = await readJsonFile(metaPath);
        unitMeta = UnitMetaSchema.parse(parsed);
      } catch (err) {
        errors.push(`Invalid meta.json in ${lang}/${folder}: ${err.message}`);
        continue;
      }

      const expectedFolder = `unit-${String(unitMeta.unitNumber).padStart(3, "0")}`;
      if (folder !== expectedFolder) {
        errors.push(
          `Folder "${folder}" does not match unitNumber ${unitMeta.unitNumber}`
        );
      }

      if (unitMeta.language !== lang) {
        errors.push(
          `Unit ${unitMeta.unitId} declares language "${unitMeta.language}" inside ${lang}/`
        );
      }

      const bpUnit = blueprintMap.get(unitMeta.unitNumber);
      if (!bpUnit) {
        errors.push(
          `Unit ${unitMeta.unitId} (#${unitMeta.unitNumber}) not found in syllabus-blueprint.json`
        );
      } else if (bpUnit.stageId !== unitMeta.stageId) {
        errors.push(
          `Unit ${unitMeta.unitId} stageId "${unitMeta.stageId}" mismatches blueprint "${bpUnit.stageId}"`
        );
      }

      registerUniqueId("unit", unitMeta.unitId, `${lang}/${folder}/meta.json`);
      unitIds.push(unitMeta.unitId);

      const shardDescriptors = {};

      for (const tier of TIER_ORDER) {
        const shardMeta = TIER_META[tier];
        const shardPath = path.join(unitPath, shardMeta.shardFile);
        if (!existsSync(shardPath)) {
          continue;
        }

        const originLabel = `${lang}/${folder}/${shardMeta.shardFile}`;
        let rawBytes;
        let shard;
        try {
          const loaded = await readJsonFile(shardPath);
          rawBytes = loaded.raw;
          shard = TierShardSchema.parse(loaded.parsed);
        } catch (err) {
          errors.push(`Schema validation failed in ${originLabel}: ${err.message}`);
          continue;
        }

        if (shard.unitId !== unitMeta.unitId) {
          errors.push(
            `${originLabel}: shard unitId "${shard.unitId}" mismatches "${unitMeta.unitId}"`
          );
        }
        if (shard.language !== lang) {
          errors.push(
            `${originLabel}: shard language "${shard.language}" mismatches "${lang}"`
          );
        }
        if (shard.tier !== tier || shard.tierNumber !== shardMeta.number) {
          errors.push(
            `${originLabel}: tier "${shard.tier}" (#${shard.tierNumber}) mismatches file ${shardMeta.shardFile}`
          );
        }

        registerUniqueId("shard", shard.shardId, originLabel);

        for (const lexId of shard.introducedLexiconIds) {
          registerUniqueId(`lexicon-${lang}`, lexId, originLabel);
          lexiconSet.add(lexId);
        }
        for (const gramId of shard.introducedGrammarIds) {
          registerUniqueId(`grammar-${lang}`, gramId, originLabel);
          grammarSet.add(gramId);
        }
        for (const k of shard.introducedKanji ?? []) {
          kanjiOrRootSet.add(k);
        }
        for (const r of shard.introducedRoots ?? []) {
          kanjiOrRootSet.add(r);
        }

        for (const step of shard.lessonSteps) {
          registerUniqueId("step", step.id, originLabel);
          if (step.tier !== tier) {
            errors.push(`${originLabel}: step "${step.id}" tier mismatches "${tier}"`);
          }
        }

        for (const drill of shard.drills) {
          registerUniqueId("drill", drill.id, originLabel);
          if (!drill.options.includes(drill.correctAnswer)) {
            errors.push(
              `${originLabel}: drill "${drill.id}" correctAnswer "${drill.correctAnswer}" must appear in options`
            );
          }
        }

        for (const card of shard.srsCards) {
          registerUniqueId("card", card.id, originLabel);
          if (card.unitId !== unitMeta.unitId || card.language !== lang || card.tier !== tier) {
            errors.push(`${originLabel}: card "${card.id}" metadata mismatches parent shard`);
          }
        }

        for (const story of shard.gradedStories) {
          registerUniqueId("story", story.id, originLabel);
          if (story.unitId !== unitMeta.unitId || story.language !== lang || story.tier !== tier) {
            errors.push(`${originLabel}: story "${story.id}" metadata mismatches parent shard`);
          }
          for (const q of story.questions) {
            registerUniqueId("question", q.id, originLabel);
            if (q.correctIndex >= q.options.length) {
              errors.push(
                `${originLabel}: question "${q.id}" correctIndex ${q.correctIndex} out of bounds`
              );
            }
          }
        }

        for (const sheet of shard.referenceSheets) {
          registerUniqueId("ref-sheet-instance", `${shard.shardId}:${sheet.id}`, originLabel);
          for (const row of sheet.rows) {
            registerUniqueId("ref-row", row.id, originLabel);
          }
        }

        shardDescriptors[tier] = {
          file: shardMeta.shardFile,
          bytes: rawBytes.byteLength,
          sha256: sha256Hex(rawBytes),
          cardCount: shard.srsCards.length,
          stepCount: shard.lessonSteps.length,
        };
      }

      manifestUnits.push({
        unitId: unitMeta.unitId,
        unitNumber: unitMeta.unitNumber,
        directory: `${lang}/${folder}`,
        stageId: unitMeta.stageId,
        title: unitMeta.title,
        subtitle: unitMeta.subtitle,
        estimatedMinutes: unitMeta.estimatedMinutes,
        shards: shardDescriptors,
      });
    }

    manifestLanguages[lang] = {
      language: lang,
      title: LANGUAGE_TITLES[lang],
      stages: blueprint.languages[lang].stages,
      units: manifestUnits,
    };

    ledgerLanguages[lang] = {
      unitIds,
      lexiconIds: Array.from(lexiconSet),
      grammarIds: Array.from(grammarSet),
      kanjiOrRoots: Array.from(kanjiOrRootSet),
    };
  }

  return {
    errors,
    blueprint,
    manifestLanguages,
    ledgerLanguages,
  };
}

export async function writeManifestAndLedger(manifestLanguages, ledgerLanguages, timestamp) {
  const updatedAt = timestamp || new Date().toISOString();

  const manifest = ManifestSchema.parse({
    schemaVersion: 1,
    updatedAt,
    languages: manifestLanguages,
  });

  const ledger = LexiconLedgerSchema.parse({
    schemaVersion: 1,
    updatedAt,
    languages: ledgerLanguages,
  });

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

  return { manifest, ledger };
}
