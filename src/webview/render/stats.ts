/** Rough reading stats; code blocks and markup don't count as words. */
export function readingStats(source: string): { words: number; minutes: number } {
  const prose = source
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/(^|\n)(```|~~~)[\s\S]*?(\n\2|$)/g, '\n')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_~|`-]+/g, ' ');
  const words = prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)?.length ?? 0;
  return { words, minutes: Math.max(1, Math.round(words / 230)) };
}
