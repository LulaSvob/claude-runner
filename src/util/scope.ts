const US_RE = /^us-(\d+\.\d+)/;
const TD_RE = /^td-(\d+)/;
const BUG_RE = /^b-(\d+)/;

export function deriveScope(storyName: string): string {
  const usMatch = US_RE.exec(storyName);
  if (usMatch?.[1]) return `US-${usMatch[1]}`;

  const tdMatch = TD_RE.exec(storyName);
  if (tdMatch?.[1]) return `TD-${tdMatch[1]}`;

  const bugMatch = BUG_RE.exec(storyName);
  if (bugMatch?.[1]) return `B-${bugMatch[1]}`;

  return storyName;
}
