import { existsSync } from "node:fs";
import {
  LEDGER_PATH,
  MANIFEST_PATH,
  readJsonFile,
  scanAndValidateCurriculum,
  writeManifestAndLedger,
} from "./lib/curriculum-io.mjs";
import {
  LexiconLedgerSchema,
  ManifestSchema,
  TIER_ORDER,
} from "../src/schemas/curriculum.ts";

async function main() {
  const args = new Set(process.argv.slice(2));
  const forceSync = args.has("--sync");

  const { errors, manifestLanguages, ledgerLanguages } =
    await scanAndValidateCurriculum();

  if (errors.length > 0) {
    console.error("Curriculum validation failed:");
    for (const issue of errors) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }

  const missingIndexFiles = !existsSync(MANIFEST_PATH) || !existsSync(LEDGER_PATH);

  if (forceSync || missingIndexFiles) {
    const existingTimestamp = existsSync(MANIFEST_PATH) && !forceSync
      ? (await readJsonFile(MANIFEST_PATH)).parsed.updatedAt
      : new Date().toISOString();

    const { manifest, ledger } = await writeManifestAndLedger(
      manifestLanguages,
      ledgerLanguages,
      existingTimestamp
    );

    const jaUnits = manifest.languages.ja.units.length;
    const deUnits = manifest.languages.de.units.length;
    console.log(
      `Generated and verified manifest.json & lexicon-ledger.json (${jaUnits} JA units, ${deUnits} DE units, ${ledger.languages.ja.lexiconIds.length + ledger.languages.de.lexiconIds.length} lexicon IDs).`
    );
    return;
  }

  const { parsed: rawManifest } = await readJsonFile(MANIFEST_PATH);
  const manifestOnDisk = ManifestSchema.parse(rawManifest);

  const { parsed: rawLedger } = await readJsonFile(LEDGER_PATH);
  const ledgerOnDisk = LexiconLedgerSchema.parse(rawLedger);

  const driftErrors = [];

  for (const lang of ["ja", "de"]) {
    const diskUnits = manifestOnDisk.languages[lang].units;
    const computedUnits = manifestLanguages[lang].units;

    if (diskUnits.length !== computedUnits.length) {
      driftErrors.push(
        `manifest.json ${lang} unit count (${diskUnits.length}) differs from disk (${computedUnits.length}).`
      );
      continue;
    }

    for (let i = 0; i < computedUnits.length; i += 1) {
      const expected = computedUnits[i];
      const actual = diskUnits[i];
      if (expected.unitId !== actual.unitId) {
        driftErrors.push(
          `manifest.json ${lang} unit mismatch at index ${i}: expected ${expected.unitId}, got ${actual.unitId}`
        );
        continue;
      }

      for (const tier of TIER_ORDER) {
        const expShard = expected.shards[tier];
        const actShard = actual.shards[tier];
        if (!expShard && !actShard) continue;
        if (!expShard || !actShard) {
          driftErrors.push(
            `manifest.json ${expected.unitId} shard "${tier}" presence mismatch.`
          );
          continue;
        }
        if (expShard.bytes !== actShard.bytes || expShard.sha256 !== actShard.sha256) {
          driftErrors.push(
            `manifest.json ${expected.unitId} (${tier}) hash/bytes drift: disk=${expShard.bytes}B/${expShard.sha256.slice(0, 10)} vs manifest=${actShard.bytes}B/${actShard.sha256.slice(0, 10)}`
          );
        }
      }
    }

    const expectedLexCount = ledgerLanguages[lang].lexiconIds.length;
    const actualLexCount = ledgerOnDisk.languages[lang].lexiconIds.length;
    if (expectedLexCount !== actualLexCount) {
      driftErrors.push(
        `lexicon-ledger.json ${lang} lexicon count (${actualLexCount}) differs from shard total (${expectedLexCount}).`
      );
    }
  }

  if (driftErrors.length > 0) {
    console.error("Manifest or ledger integrity check failed:");
    for (const drift of driftErrors) {
      console.error(`  - ${drift}`);
    }
    console.error("Run `npm run curriculum:validate -- --sync` to update hashes.");
    process.exit(1);
  }

  const totalUnits =
    manifestOnDisk.languages.ja.units.length +
    manifestOnDisk.languages.de.units.length;
  console.log(
    `Verified ${totalUnits} curriculum units across ja & de: all schemas, <ruby> annotations, compound splits, byte counts, SHA-256 hashes, and unique IDs valid.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
