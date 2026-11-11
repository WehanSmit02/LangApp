export const BRAND = {
  appName: "Lang",
  slug: "lang",
  dbName: "lang_offline_db",
  storagePrefix: "lang_prefs_",
  defaultRepoOwner: "WehanSmit02",
  defaultRepoName: "LangApp",
  defaultBranch: "main",
} as const;

export function resolveCurriculumBaseUrl(
  customOverride: string | undefined,
  appBaseUrl = "/"
): string {
  const trimmed = customOverride?.trim() ?? "";
  if (trimmed.length > 0) {
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/\/+$/, "");
    }
    const repoMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_./-]+))?$/);
    if (repoMatch) {
      const [, owner, repo, branch] = repoMatch;
      const targetBranch = branch || BRAND.defaultBranch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${targetBranch}/public/curriculum`;
    }
  }

  const normalizedBase = appBaseUrl.endsWith("/") ? appBaseUrl : `${appBaseUrl}/`;
  return `${normalizedBase}curriculum`;
}
