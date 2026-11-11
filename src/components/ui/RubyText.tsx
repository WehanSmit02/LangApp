import { Fragment } from "react";

const RUBY_TOKENIZER = /<ruby>([^<]+)<rt>([^<]+)<\/rt><\/ruby>/g;

export function RubyText({
  rubyHtml,
  fallbackText,
  showFurigana = true,
  className = "",
}: {
  rubyHtml?: string;
  fallbackText: string;
  showFurigana?: boolean;
  className?: string;
}) {
  if (!rubyHtml || !rubyHtml.includes("<ruby>")) {
    return <span className={className}>{fallbackText}</span>;
  }

  const nodes: Array<
    | { kind: "plain"; text: string }
    | { kind: "ruby"; base: string; reading: string }
  > = [];

  let lastIdx = 0;
  for (const match of rubyHtml.matchAll(RUBY_TOKENIZER)) {
    const idx = match.index ?? 0;
    if (idx > lastIdx) {
      nodes.push({ kind: "plain", text: rubyHtml.slice(lastIdx, idx) });
    }
    nodes.push({ kind: "ruby", base: match[1], reading: match[2] });
    lastIdx = idx + match[0].length;
  }
  if (lastIdx < rubyHtml.length) {
    nodes.push({ kind: "plain", text: rubyHtml.slice(lastIdx) });
  }

  return (
    <span
      className={`ruby-surface ${showFurigana ? "" : "furigana-hidden"} ${className}`.trim()}
    >
      {nodes.map((node, idx) =>
        node.kind === "plain" ? (
          <Fragment key={idx}>{node.text}</Fragment>
        ) : (
          <ruby key={idx}>
            {node.base}
            <rt aria-hidden={!showFurigana}>{node.reading}</rt>
          </ruby>
        )
      )}
    </span>
  );
}

export function CompoundWordText({
  surface,
  compoundParts,
  showDividers,
  className = "",
}: {
  surface: string;
  compoundParts?: string[];
  showDividers: boolean;
  className?: string;
}) {
  if (!compoundParts || compoundParts.length < 2) {
    return <span className={`break-words ${className}`.trim()}>{surface}</span>;
  }

  return (
    <span className={`break-words ${className}`.trim()}>
      {compoundParts.map((part, idx) => (
        <Fragment key={idx}>
          {idx > 0 &&
            (showDividers ? (
              <span
                aria-hidden="true"
                className="mx-[0.5px] text-[var(--accent)] opacity-80"
              >
                ·
              </span>
            ) : (
              <wbr />
            ))}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
