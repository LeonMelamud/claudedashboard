import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Deterministic hue (0-359) from a string, for avatar colors. */
export function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function initialsOf(name: string): string {
  const parts = name
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + second).toUpperCase();
}

/** Simple fuzzy subsequence matcher; returns a score (higher = better) or null when no match. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (q.length === 0) return 0;
  if (t.includes(q)) return 100 - t.indexOf(q) - (t.length - q.length) * 0.01;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = false;
    while (ti < t.length) {
      if (t[ti] === ch) {
        streak++;
        score += 1 + streak;
        ti++;
        found = true;
        break;
      }
      streak = 0;
      ti++;
    }
    if (!found) return null;
  }
  return score - t.length * 0.01;
}
