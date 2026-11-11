import { existsSync } from "node:fs";
import path from "node:path";
import {
  readJsonFile,
  resolveCurriculumRoot,
  scanAndValidateCurriculum,
  writeManifestAndCourseLedgers,
} from "./lib/curriculum-io.mjs";
import {
  CourseLexiconLedgerSchema,
  ManifestSchema,
  TIER_ORDER,
} from "../src/schemas/curriculum.ts";

async function main() {
  const args = new Set(process.argv.slice(2));
  const forceSync = args.has("--sync");
  const curriculumRoot = resolveCurriculumRoot();
  const manifestPath = path.join(curriculumRoot, "manifest.json");

  const { courseIds, errors, manifestCourses, courseLedgers } =
    await scanAndValidateCurriculum(curriculumRoot);

  if (errors.length > 0) {
    console.error("Curriculum validation failed:");
    for (const issue of errors) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }

  const missingLedger = courseIds.some(
    (cid) =>
      !existsSync(path.join(curriculumRoot, "courses", cid, "lexicon-ledger.json"))
  );
  const missingIndexFiles = !existsSync(manifestPath) || missingLedger;

  if (forceSync || missingIndexFiles) {
    const existingTimestamp =
      existsSync(manifestPath) && !forceSync
        ? (await readJsonFile(manifestPath)).parsed.updatedAt
        : new Date().toISOString();

    const { manifest, writtenLedgers } = await writeManifestAndCourseLedgers(
      curriculumRoot,
      manifestCourses,
      courseLedgers,
      existingTimestamp
    );

    const totalUnits = manifest.courses.reduce(
      (sum, c) => sum + c.units.length,
      0
    );
    const totalLexicon = Object.values(writtenLedgers).reduce(
      (sum, l) => sum + l.lexiconIds.length,
      0
    );
    console.log(
      `Generated and verified manifest.json & course ledgers across ${manifest.courses.length} course(s) (${courseIds.join(", ")}): ${totalUnits} units, ${totalLexicon} lexicon IDs.`
    );
    return;
  }

  const { parsed: rawManifest } = await readJsonFile(manifestPath);
  const manifestOnDisk = ManifestSchema.parse(rawManifest);

  const driftErrors = [];
  if (manifestOnDisk.courses.length !== manifestCourses.length) {
    driftErrors.push(
      `manifest.json course count (${manifestOnDisk.courses.length}) differs from disk (${manifestCourses.length}).`
    );
  } else {
    for (let cIdx = 0; cIdx < manifestCourses.length; cIdx += 1) {
      const expectedCourse = manifestCourses[cIdx];
      const actualCourse = manifestOnDisk.courses.find(
        (c) => c.courseId === expectedCourse.courseId
      );
      if (!actualCourse) {
        driftErrors.push(
          `Course "${expectedCourse.courseId}" missing from manifest.json.`
        );
        continue;
      }

      if (actualCourse.units.length !== expectedCourse.units.length) {
        driftErrors.push(
          `manifest.json "${expectedCourse.courseId}" unit count (${actualCourse.units.length}) differs from disk (${expectedCourse.units.length}).`
        );
        continue;
      }

      for (let uIdx = 0; uIdx < expectedCourse.units.length; uIdx += 1) {
        const expUnit = expectedCourse.units[uIdx];
        const actUnit = actualCourse.units[uIdx];
        if (expUnit.unitId !== actUnit.unitId) {
          driftErrors.push(
            `manifest.json "${expectedCourse.courseId}" unit mismatch at #${uIdx}: expected ${expUnit.unitId}, got ${actUnit.unitId}`
          );
          continue;
        }

        for (const tier of TIER_ORDER) {
          const expShard = expUnit.shards[tier];
          const actShard = actUnit.shards[tier];
          if (!expShard && !actShard) continue;
          if (!expShard || !actShard) {
            driftErrors.push(
              `manifest.json ${expUnit.unitId} shard "${tier}" presence mismatch.`
            );
            continue;
          }
          if (
            expShard.bytes !== actShard.bytes ||
            expShard.sha256 !== actShard.sha256
          ) {
            driftErrors.push(
              `manifest.json ${expUnit.unitId} (${tier}) hash/bytes drift: disk=${expShard.bytes}B/${expShard.sha256.slice(0, 10)} vs manifest=${actShard.bytes}B/${actShard.sha256.slice(0, 10)}`
            );
          }
        }
      }

      const ledgerPath = path.join(
        curriculumRoot,
        "courses",
        expectedCourse.courseId,
        "lexicon-ledger.json"
      );
      const { parsed: rawLedger } = await readJsonFile(ledgerPath);
      const ledgerOnDisk = CourseLexiconLedgerSchema.parse(rawLedger);
      const expectedLexCount =
        courseLedgers[expectedCourse.courseId].lexiconIds.length;
      if (ledgerOnDisk.lexiconIds.length !== expectedLexCount) {
        driftErrors.push(
          `courses/${expectedCourse.courseId}/lexicon-ledger.json count (${ledgerOnDisk.lexiconIds.length}) differs from shard total (${expectedLexCount}).`
        );
      }
    }
  }

  if (driftErrors.length > 0) {
    console.error("Manifest or course ledger integrity check failed:");
    for (const drift of driftErrors) {
      console.error(`  - ${drift}`);
    }
    console.error("Run `npm run curriculum:validate -- --sync` to update hashes.");
    process.exit(1);
  }

  const totalUnits = manifestOnDisk.courses.reduce(
    (sum, c) => sum + c.units.length,
    0
  );
  console.log(
    `Verified ${manifestOnDisk.courses.length} course(s) (${courseIds.join(", ")}) and ${totalUnits} unit(s): all schemas, reading capability flags, byte counts, SHA-256 hashes, and unique IDs valid.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
