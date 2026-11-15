/** GitHub-flavoured heading slugs: lowercase, drop punctuation, spaces become dashes. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export class Slugger {
  private readonly seen = new Map<string, number>();

  slug(text: string): string {
    const base = slugify(text) || 'section';
    let candidate = base;
    let count = this.seen.get(base) ?? 0;
    while (this.seen.has(candidate)) {
      count++;
      candidate = `${base}-${count}`;
    }
    this.seen.set(base, count);
    this.seen.set(candidate, 0);
    return candidate;
  }
}
