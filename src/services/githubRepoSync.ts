import { BRAND } from "../config/brand";

export type RepoTransportMode = "public" | "private" | "local";

export interface CurriculumRepoConfig {
  mode: "public" | "private";
  owner: string;
  repo: string;
  branch: string;
  privateToken: string;
  useLocalWorkspace: boolean;
}

export const DEFAULT_REPO_CONFIG: CurriculumRepoConfig = {
  mode: "public",
  owner: BRAND.curriculumRepo.owner,
  repo: BRAND.curriculumRepo.repo,
  branch: BRAND.curriculumRepo.branch,
  privateToken: "",
  useLocalWorkspace: false,
};

export interface CurriculumFetchOptions {
  expectedBytes?: number;
  sha256?: string;
  cacheBustMinute?: boolean;
  timeoutMs?: number;
  onChunkBytes?: (deltaBytes: number) => void;
}

function sanitizeRelativePath(relPath: string): string {
  return relPath
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "..")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildQuerySuffix(options?: {
  sha256?: string;
  cacheBustMinute?: boolean;
}): string {
  if (options?.sha256) {
    return `?sha=${encodeURIComponent(options.sha256.slice(0, 8))}`;
  }
  if (options?.cacheBustMinute) {
    return `?v=${Math.floor(Date.now() / 60000)}`;
  }
  return "";
}

function normalizeCoordinates(config: CurriculumRepoConfig): {
  owner: string;
  repo: string;
  branch: string;
} {
  return {
    owner: config.owner.trim() || BRAND.curriculumRepo.owner,
    repo: config.repo.trim() || BRAND.curriculumRepo.repo,
    branch: config.branch.trim() || BRAND.curriculumRepo.branch,
  };
}

export function resolveEffectiveTransportMode(
  config: CurriculumRepoConfig
): RepoTransportMode {
  if (import.meta.env.DEV && config.useLocalWorkspace) {
    return "local";
  }
  if (config.mode === "private") {
    return "private";
  }
  return "public";
}

export function buildRawGithubUrl(
  config: CurriculumRepoConfig,
  relPath: string,
  options?: { sha256?: string; cacheBustMinute?: boolean }
): string {
  const { owner, repo, branch } = normalizeCoordinates(config);
  const cleanPath = sanitizeRelativePath(relPath);
  const query = buildQuerySuffix(options);
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/curriculum/${cleanPath}${query}`;
}

export function buildJsDelivrUrl(
  config: CurriculumRepoConfig,
  relPath: string,
  options?: { sha256?: string; cacheBustMinute?: boolean }
): string {
  const { owner, repo, branch } = normalizeCoordinates(config);
  const cleanPath = sanitizeRelativePath(relPath);
  const query = buildQuerySuffix(options);
  return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}@${encodeURIComponent(branch)}/curriculum/${cleanPath}${query}`;
}

export function buildGithubApiContentsUrl(
  config: CurriculumRepoConfig,
  relPath: string
): string {
  const { owner, repo, branch } = normalizeCoordinates(config);
  const cleanPath = sanitizeRelativePath(relPath);
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/curriculum/${cleanPath}?ref=${encodeURIComponent(branch)}`;
}

export function buildLocalCurriculumUrl(
  relPath: string,
  options?: { sha256?: string; cacheBustMinute?: boolean }
): string {
  const cleanPath = sanitizeRelativePath(relPath);
  const query = buildQuerySuffix(options);
  return `/curriculum/${cleanPath}${query}`;
}

export function describeActiveEndpoint(config: CurriculumRepoConfig): string {
  const effective = resolveEffectiveTransportMode(config);
  const { owner, repo, branch } = normalizeCoordinates(config);
  if (effective === "local") {
    return "/curriculum/* (Local Workspace)";
  }
  if (effective === "private") {
    return `api.github.com/repos/${owner}/${repo} (${branch})`;
  }
  return `raw.githubusercontent.com/${owner}/${repo}/${branch}`;
}

async function readResponseStreamAsJson<T>(
  response: Response,
  expectedBytes = 0,
  onChunkBytes?: (deltaBytes: number) => void
): Promise<T> {
  if (!response.body || !onChunkBytes) {
    const text = await response.text();
    onChunkBytes?.(expectedBytes || text.length);
    return JSON.parse(text) as T;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let reportedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      reportedBytes += value.byteLength;
      onChunkBytes(value.byteLength);
    }
  }

  if (expectedBytes > reportedBytes) {
    onChunkBytes(expectedBytes - reportedBytes);
  }

  const totalLen = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const decoded = new TextDecoder("utf-8").decode(merged);
  return JSON.parse(decoded) as T;
}

async function executeSimpleCorsGet<T>(
  url: string,
  timeoutMs: number,
  expectedBytes?: number,
  onChunkBytes?: (deltaBytes: number) => void
): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Strictly simple GET with zero custom HTTP headers so browsers never emit OPTIONS preflights to GitHub Raw.
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      const statusError = new Error(
        `HTTP ${response.status} from ${new URL(url, "https://localhost").hostname}`
      ) as Error & { status?: number };
      statusError.status = response.status;
      throw statusError;
    }
    return await readResponseStreamAsJson<T>(
      response,
      expectedBytes,
      onChunkBytes
    );
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function executePrivateRepoGet<T>(
  url: string,
  token: string,
  timeoutMs: number,
  expectedBytes?: number,
  onChunkBytes?: (deltaBytes: number) => void
): Promise<T> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new Error(
      "Add a read-only GitHub Personal Access Token in Settings to sync from a private repository."
    );
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github.raw+json",
        Authorization: `Bearer ${trimmedToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "GitHub rejected the token. Confirm it has Contents: Read-only access to the repository."
        );
      }
      if (response.status === 404) {
        throw new Error(
          "Course files were not found on the configured branch. Confirm the curriculum-data branch exists."
        );
      }
      throw new Error(`GitHub API returned status ${response.status}.`);
    }

    return await readResponseStreamAsJson<T>(
      response,
      expectedBytes,
      onChunkBytes
    );
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function fetchCurriculumJson<T>(
  relPath: string,
  config: CurriculumRepoConfig,
  options?: CurriculumFetchOptions
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 9000;
  const effectiveMode = resolveEffectiveTransportMode(config);

  if (effectiveMode === "local") {
    const localUrl = buildLocalCurriculumUrl(relPath, {
      sha256: options?.sha256,
      cacheBustMinute: options?.cacheBustMinute,
    });
    return executeSimpleCorsGet<T>(
      localUrl,
      timeoutMs,
      options?.expectedBytes,
      options?.onChunkBytes
    );
  }

  if (effectiveMode === "private") {
    const apiUrl = buildGithubApiContentsUrl(config, relPath);
    return executePrivateRepoGet<T>(
      apiUrl,
      config.privateToken,
      timeoutMs,
      options?.expectedBytes,
      options?.onChunkBytes
    );
  }

  const rawUrl = buildRawGithubUrl(config, relPath, {
    sha256: options?.sha256,
    cacheBustMinute: options?.cacheBustMinute,
  });

  try {
    return await executeSimpleCorsGet<T>(
      rawUrl,
      timeoutMs,
      options?.expectedBytes,
      options?.onChunkBytes
    );
  } catch {
    const jsDelivrUrl = buildJsDelivrUrl(config, relPath, {
      sha256: options?.sha256,
      cacheBustMinute: options?.cacheBustMinute,
    });

    try {
      return await executeSimpleCorsGet<T>(
        jsDelivrUrl,
        timeoutMs,
        options?.expectedBytes,
        options?.onChunkBytes
      );
    } catch (fallbackErr) {
      if (import.meta.env.DEV) {
        try {
          const devLocalUrl = buildLocalCurriculumUrl(relPath, {
            sha256: options?.sha256,
            cacheBustMinute: options?.cacheBustMinute,
          });
          return await executeSimpleCorsGet<T>(
            devLocalUrl,
            timeoutMs,
            options?.expectedBytes,
            options?.onChunkBytes
          );
        } catch {
          // Surface the remote error below if local middleware also failed
        }
      }

      const status = (fallbackErr as { status?: number })?.status;
      if (status === 404) {
        throw new Error(
          "Curriculum branch not found or repository is private. Switch to Private Token mode in Settings if your repository is private."
        );
      }
      throw fallbackErr instanceof Error
        ? fallbackErr
        : new Error("Unable to reach GitHub Raw or jsDelivr course mirrors.");
    }
  }
}
