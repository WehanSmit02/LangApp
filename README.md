# Lang

Offline-first Progressive Web App for adaptive Japanese (`Kana → JLPT N1`) and German / Austrian (`Survival Roots → CEFR C1`) study, backed by an on-demand GitHub curriculum CDN.

## Local Development

```bash
npm install
npm run curriculum:validate
npm run dev
```

Build the production PWA bundle:

```bash
npm run build
```

## Renaming the Brand

All user-facing names, IndexedDB identifiers, local storage prefixes, and default repository coordinates live in [`src/config/brand.ts`](./src/config/brand.ts):

```ts
export const BRAND = {
  appName: "Lang",
  slug: "lang",
  dbName: "lang_offline_db",
  storagePrefix: "lang_prefs_",
  defaultRepoOwner: "WehanSmit02",
  defaultRepoName: "LangApp",
  defaultBranch: "main",
} as const;
```

Edit `BRAND` in that single file to rename the app across headers, onboarding, PWA manifest metadata, Capacitor config, and local storage keys.

## Enabling GitHub Pages Hosting & Curriculum CDN

1. Push the repository to GitHub on the `main` branch.
2. Open **Settings → Pages** in your GitHub repository.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. The [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) workflow automatically validates curriculum shards, builds the Vite PWA shell (`< 250 KB` gzipped), and serves `curriculum/manifest.json` plus unit tier shards on demand.

## Automated Daily Course Generation

The [`.github/workflows/daily-curriculum.yml`](./.github/workflows/daily-curriculum.yml) workflow expands the 60-unit Japanese and German courses every day at `03:00 UTC` (or on demand via **Actions → Daily Curriculum Shards → Run workflow**):

1. Open **Settings → Secrets and variables → Actions** in your GitHub repository.
2. Click **New repository secret** and add `GEMINI_API_KEY` with your Google Gemini API key.
3. Each run selects the next ungenerated syllabus unit from `public/curriculum/syllabus-blueprint.json`, generates all 4 additive tier shards (`tier-1-essential.json` through `tier-4-fluent.json`), validates `<ruby>` Furigana and German compound splits via Zod, updates `lexicon-ledger.json` and `manifest.json` SHA-256 hashes, and commits to `main`.

## Wiring Up iOS Shortcuts (`?lock=1`)

Phrase Lock intercepts distracting app launches and prompts for one spoken phrase (weighted by your Japanese/German split) before granting a timed unlock window:

1. Open **Lang → Settings → Phrase Lock Automation** and tap **Copy iOS Shortcuts URL** for your target app (for example, `https://<owner>.github.io/<repo>/?lock=1&app=Instagram&scheme=instagram%3A%2F%2F`).
2. Open the **Shortcuts** app on iOS → **Automation** → **New Automation**.
3. Choose **App** → select the target app (e.g. Instagram) → **Is Opened** → **Run Immediately**.
4. Add the **Open URLs** action and paste the copied `?lock=1` URL.
5. Speaking the prompt above your configured accuracy threshold (or using the quiet-room **Type to Unlock** option) grants a 15-minute pass and redirects straight back to the app scheme.
