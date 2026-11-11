import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
} from "../../src/schemas/curriculum.ts";

export function resolveCurriculumRoot() {
  const envDir = process.env.CURRICULUM_DIR?.trim();
  return envDir
    ? path.resolve(process.cwd(), envDir)
    : path.resolve(process.cwd(), "curriculum");
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function readJsonFile(filePath) {
  const raw = await readFile(filePath);
  const parsed = JSON.parse(raw.toString("utf8"));
  return { raw, parsed };
}

export async function discoverCourseIds(curriculumRoot = resolveCurriculumRoot()) {
  const coursesDir = path.join(curriculumRoot, "courses");
  if (!existsSync(coursesDir)) {
    return [];
  }
  const entries = await readdir(coursesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => {
      if (a === "ja") return -1;
      if (b === "ja") return 1;
      if (a === "de" && b !== "ja") return -1;
      if (b === "de" && a !== "ja") return 1;
      return a.localeCompare(b);
    });
}

export async function scanAndValidateCurriculum(
  curriculumRoot = resolveCurriculumRoot()
) {
  const courseIds = await discoverCourseIds(curriculumRoot);
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

  if (courseIds.length === 0) {
    errors.push(`No course directories found in ${path.join(curriculumRoot, "courses")}`);
  }

  const manifestCourses = [];
  const courseLedgers = {};

  for (const courseId of courseIds) {
    const courseDir = path.join(curriculumRoot, "courses", courseId);
    const descriptorPath = path.join(courseDir, "course.json");
    const blueprintPath = path.join(courseDir, "syllabus-blueprint.json");
    const unitsRoot = path.join(courseDir, "units");

    if (!existsSync(descriptorPath)) {
      errors.push(`Missing course.json in courses/${courseId}`);
      continue;
    }
    if (!existsSync(blueprintPath)) {
      errors.push(`Missing syllabus-blueprint.json in courses/${courseId}`);
      continue;
    }

    let descriptor;
    try {
      const { parsed } = await readJsonFile(descriptorPath);
      descriptor = CourseDescriptorSchema.parse(parsed);
      if (descriptor.id !== courseId) {
        errors.push(
          `courses/${courseId}/course.json declares id "${descriptor.id}" instead of "${courseId}"`
        );
      }
    } catch (err) {
      errors.push(`Invalid courses/${courseId}/course.json: ${err.message}`);
      continue;
    }

    let blueprint;
    try {
      const { parsed } = await readJsonFile(blueprintPath);
      blueprint = CourseBlueprintSchema.parse(parsed);
      if (blueprint.courseId !== courseId) {
        errors.push(
          `courses/${courseId}/syllabus-blueprint.json declares courseId "${blueprint.courseId}"`
        );
      }
    } catch (err) {
      errors.push(
        `Invalid courses/${courseId}/syllabus-blueprint.json: ${err.message}`
      );
      continue;
    }

    const validStageIds = new Set(
      descriptor.proficiencyFramework.stages.map((s) => s.id)
    );
    for (const bpStage of blueprint.stages) {
      if (!validStageIds.has(bpStage.id)) {
        errors.push(
          `courses/${courseId}: blueprint stage "${bpStage.id}" missing in course.json proficiencyFramework.stages`
        );
      }
    }

    const blueprintMap = new Map(
      blueprint.units.map((u) => [u.unitNumber, u])
    );

    const unitDirEntries = existsSync(unitsRoot)
      ? await readdir(unitsRoot, { withFileTypes: true })
      : [];
    const unitFolders = unitDirEntries
      .filter((e) => e.isDirectory() && /^unit-\d{3}$/.test(e.name))
      .map((e) => e.name)
      .sort();

    const manifestUnits = [];
    const unitIds = [];
    const lexiconSet = new Set();
    const grammarSet = new Set();
    const orthographySet = new Set();

    for (const folder of unitFolders) {
      const unitPath = path.join(unitsRoot, folder);
      const metaPath = path.join(unitPath, "meta.json");
      const relUnitDir = `courses/${courseId}/units/${folder}`;

      if (!existsSync(metaPath)) {
        errors.push(`Missing meta.json in ${relUnitDir}`);
        continue;
      }

      let unitMeta;
      try {
        const { parsed } = await readJsonFile(metaPath);
        unitMeta = UnitMetaSchema.parse(parsed);
      } catch (err) {
        errors.push(`Invalid ${relUnitDir}/meta.json: ${err.message}`);
        continue;
      }

      const expectedFolder = `unit-${String(unitMeta.unitNumber).padStart(3, "0")}`;
      if (folder !== expectedFolder) {
        errors.push(
          `${relUnitDir}: folder name mismatches unitNumber ${unitMeta.unitNumber}`
        );
      }
      if (unitMeta.courseId !== courseId) {
        errors.push(
          `${relUnitDir}/meta.json: courseId "${unitMeta.courseId}" mismatches "${courseId}"`
        );
      }

      const bpUnit = blueprintMap.get(unitMeta.unitNumber);
      if (!bpUnit) {
        errors.push(
          `${relUnitDir}: unit #${unitMeta.unitNumber} not declared in syllabus-blueprint.json`
        );
      } else if (bpUnit.stageId !== unitMeta.stageId) {
        errors.push(
          `${relUnitDir}: stageId "${unitMeta.stageId}" mismatches blueprint "${bpUnit.stageId}"`
        );
      }

      registerUniqueId("unit", unitMeta.unitId, `${relUnitDir}/meta.json`);
      unitIds.push(unitMeta.unitId);

      const shardDescriptors = {};

      for (const tier of TIER_ORDER) {
        const shardMeta = TIER_META[tier];
        const shardPath = path.join(unitPath, shardMeta.shardFile);
        if (!existsSync(shardPath)) {
          continue;
        }

        const originLabel = `${relUnitDir}/${shardMeta.shardFile}`;
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

        const capabilityIssues = validateShardReadingCapabilities(
          shard,
          descriptor
        );
        for (const capIssue of capabilityIssues) {
          errors.push(`${originLabel}: ${capIssue}`);
        }

        if (shard.unitId !== unitMeta.unitId) {
          errors.push(
            `${originLabel}: shard unitId "${shard.unitId}" mismatches "${unitMeta.unitId}"`
          );
        }
        if (shard.courseId !== courseId) {
          errors.push(
            `${originLabel}: shard courseId "${shard.courseId}" mismatches "${courseId}"`
          );
        }
        if (shard.tier !== tier || shard.tierNumber !== shardMeta.number) {
          errors.push(
            `${originLabel}: tier "${shard.tier}" (#${shard.tierNumber}) mismatches ${shardMeta.shardFile}`
          );
        }

        registerUniqueId("shard", shard.shardId, originLabel);

        for (const lexId of shard.introducedLexiconIds) {
          registerUniqueId(`lexicon-${courseId}`, lexId, originLabel);
          lexiconSet.add(lexId);
        }
        for (const gramId of shard.introducedGrammarIds) {
          registerUniqueId(`grammar-${courseId}`, gramId, originLabel);
          grammarSet.add(gramId);
        }
        for (const orth of shard.introducedOrthography ?? []) {
          orthographySet.add(orth);
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
          if (
            card.unitId !== unitMeta.unitId ||
            card.courseId !== courseId ||
            card.tier !== tier
          ) {
            errors.push(`${originLabel}: card "${card.id}" metadata mismatches parent shard`);
          }
        }

        for (const story of shard.gradedStories) {
          registerUniqueId("story", story.id, originLabel);
          if (
            story.unitId !== unitMeta.unitId ||
            story.courseId !== courseId ||
            story.tier !== tier
          ) {
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
          registerUniqueId(
            "ref-sheet-instance",
            `${shard.shardId}:${sheet.id}`,
            originLabel
          );
          if (sheet.courseId !== courseId) {
            errors.push(
              `${originLabel}: referenceSheet "${sheet.id}" courseId mismatches "${courseId}"`
            );
          }
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
        directory: relUnitDir,
        stageId: unitMeta.stageId,
        title: unitMeta.title,
        subtitle: unitMeta.subtitle,
        estimatedMinutes: unitMeta.estimatedMinutes,
        shards: shardDescriptors,
      });
    }

    const { scriptGrids, ...descriptorWithoutGrids } = descriptor;

    manifestCourses.push({
      courseId,
      version: 2,
      courseDescriptorPath: `courses/${courseId}/course.json`,
      blueprintPath: `courses/${courseId}/syllabus-blueprint.json`,
      unitCount: manifestUnits.length,
      totalPlannedUnits: blueprint.units.length,
      descriptor: {
        ...descriptorWithoutGrids,
        hasScriptGrids: Boolean(scriptGrids && scriptGrids.length > 0),
      },
      units: manifestUnits,
    });

    courseLedgers[courseId] = {
      schemaVersion: 2,
      courseId,
      updatedAt: new Date().toISOString(),
      unitIds,
      lexiconIds: Array.from(lexiconSet),
      grammarIds: Array.from(grammarSet),
      orthographyItems: Array.from(orthographySet),
    };
  }

  return {
    curriculumRoot,
    courseIds,
    errors,
    manifestCourses,
    courseLedgers,
  };
}

export async function writeManifestAndCourseLedgers(
  curriculumRoot,
  manifestCourses,
  courseLedgers,
  timestamp
) {
  const updatedAt = timestamp || new Date().toISOString();

  const manifest = ManifestSchema.parse({
    schemaVersion: 2,
    updatedAt,
    courses: manifestCourses,
  });

  const manifestPath = path.join(curriculumRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const writtenLedgers = {};
  for (const [courseId, rawLedger] of Object.entries(courseLedgers)) {
    const ledger = CourseLexiconLedgerSchema.parse({
      ...rawLedger,
      updatedAt,
    });
    const ledgerPath = path.join(
      curriculumRoot,
      "courses",
      courseId,
      "lexicon-ledger.json"
    );
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    writtenLedgers[courseId] = ledger;
  }

  return { manifest, writtenLedgers };
}
