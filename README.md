# Lang

Offline-first Progressive Web App (Capacitor-ready for iOS and Android) with direct-from-repository course syncing (`curriculum-data`) and a zero-rebuild dynamic multi-language capability engine.

## Local Development

```bash
npm install
npm run curriculum:validate
npm run dev
```

In development (`npm run dev`), Vite attaches a local `/curriculum/*` middleware backed by the top-level [`curriculum/`](./curriculum) directory. You can toggle **Use Local Workspace Curriculum** under **Settings → Course Repository**.

Build the host-agnostic production PWA shell (`< 250 KB` gzipped; coursework is never bundled into `dist/`):

```bash
npm run build
```

## Renaming the Brand & Repository Coordinates

All user-facing brand strings, IndexedDB names, storage prefixes, and default GitHub curriculum coordinates live in [`src/config/brand.ts`](./src/config/brand.ts):

```ts
export const BRAND = {
  appName: "Lang",
  slug: "lang",
  dbName: "lang_offline_db",
  storagePrefix: "lang_prefs_",
  curriculumRepo: {
    owner: "WehanSmit02",
    repo: "LangApp",
    branch: "curriculum-data",
  },
} as const;
```

## Direct-from-Repo Course Sync (`curriculum-data`)

Course manifests, capability descriptors (`course.json`), syllabus blueprints, and additive unit tier shards (`tier-1-essential.json` through `tier-4-fluent.json`) live on the dedicated `curriculum-data` branch so daily course generation never triggers frontend rebuilds.

Under **Settings → Course Repository**, Lang supports three transport modes:

1. **Public Direct (Default)**: Fetches `manifest.json` and unit shards from `raw.githubusercontent.com/<owner>/<repo>/<branch>/curriculum/...` using simple CORS `GET` requests (zero custom headers, minute-bucketed `?v=` cache busting on manifests, `?sha=` on immutable shards) with automatic failover to `cdn.jsdelivr.net`.
2. **Private Token (Optional)**: Routes requests through `api.github.com/repos/<owner>/<repo>/contents/curriculum/...` using a Fine-Grained Personal Access Token with **Contents: Read-only** permission.
3. **Local Workspace (`DEV` only)**: Serves local `/curriculum/*` directly from your working tree.

## Automated Daily Course Expansion & Adding New Languages

1. In your GitHub repository, open **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**.
2. Open **Settings → Secrets and variables → Actions** and add `GEMINI_API_KEY`.
3. **Daily Course Expansion**: [`.github/workflows/daily-curriculum.yml`](./.github/workflows/daily-curriculum.yml) runs at `03:00 UTC` (or manually via `workflow_dispatch`), checks out the `curriculum-data` branch, generates the next ungenerated unit across all 4 Understanding Tiers, validates capability flags and SHA-256 hashes, and pushes to `curriculum-data`.
4. **Add Any New Language (Zero App Rebuilds)**:
   - **On GitHub**: Run **Actions → Add Language Course** ([`.github/workflows/add-language.yml`](./.github/workflows/add-language.yml)) with `course_id` (for example `ko`, `es`, `ar`), `course_name` (`Korean`), and optional `regional_variants`.
   - **Locally**:
     ```bash
     npm run curriculum:add-language -- --id ko --name Korean
     npm run curriculum:validate
     ```
   - Tap **Courses → Add Language** inside the app to enroll immediately—the app automatically adapts study-split sliders, reading toggles (`<ruby>` annotations, compound dividers, romanization), script soundboards, RTL/LTR layout, TTS/STT locales, SM-2 queues, and Phrase Lock from `course.json`.

## Capacitor Mobile Wrapping & Phrase Lock (`?lock=1`)

- **Capacitor**: [`capacitor.config.ts`](./capacitor.config.ts) is preconfigured for iOS and Android wrapping (`npx cap sync`), alongside the native Android foreground shield reference in [`native-android/PhraseLockAccessibilityService.kt`](./native-android/PhraseLockAccessibilityService.kt).
- **iOS Shortcuts Automation**:
  1. Open **Settings → Phrase Lock Automation** and tap **Copy iOS Shortcuts URL** for your target app (`https://<your-host>/?lock=1&app=Instagram&scheme=instagram%3A%2F%2F`).
  2. In iOS **Shortcuts → Automation → New Automation**, choose **App → Is Opened → Run Immediately** and add **Open URLs** with the copied link.
  3. Speaking the prompted phrase above your accuracy threshold (or using **Type to Unlock** in quiet spaces) grants a timed unlock pass and redirects straight back to the target app.
