import type { LanguageCode } from "../schemas/curriculum";

function katakanaToHiragana(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

export function normalizeSpeechString(
  raw: string,
  language: LanguageCode
): string {
  let text = raw
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:()[\]"'„“»«。、！？「」『』・〜~…—–-]/g, "");

  if (language === "ja") {
    text = katakanaToHiragana(text).replace(/\s+/g, "");
  } else {
    text = text
      .replace(/ß/g, "ss")
      .replace(/\s+/g, " ")
      .trim();
  }

  return text;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Uint16Array(b.length + 1);
  const curr = new Uint16Array(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    const charA = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
      const deletion = prev[j] + 1;
      const insertion = curr[j - 1] + 1;
      const substitution = prev[j - 1] + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    prev.set(curr);
  }

  return prev[b.length];
}

export function scoreSingleCandidate(
  spoken: string,
  referenceTargets: string[],
  language: LanguageCode
): number {
  const normalizedSpoken = normalizeSpeechString(spoken, language);
  if (!normalizedSpoken) return 0;

  let best = 0;
  for (const ref of referenceTargets) {
    if (!ref) continue;
    const normalizedRef = normalizeSpeechString(ref, language);
    if (!normalizedRef) continue;
    if (normalizedSpoken === normalizedRef) return 100;

    const maxLen = Math.max(normalizedSpoken.length, normalizedRef.length);
    const distance = levenshteinDistance(normalizedSpoken, normalizedRef);
    const pct = Math.max(0, Math.round((1 - distance / maxLen) * 100));
    if (pct > best) {
      best = pct;
    }
  }

  return best;
}

export function scoreBestSpeechMatch(
  transcriptCandidates: string[],
  referenceTargets: string[],
  language: LanguageCode
): { bestScore: number; bestTranscript: string } {
  let bestScore = 0;
  let bestTranscript = transcriptCandidates[0] ?? "";

  for (const candidate of transcriptCandidates) {
    const score = scoreSingleCandidate(candidate, referenceTargets, language);
    if (score > bestScore) {
      bestScore = score;
      bestTranscript = candidate;
    }
  }

  return { bestScore, bestTranscript };
}
