/** 文字 2-gram の集合。1 文字以下なら文字そのもの。 */
export function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 2) {
    if (s.length === 1) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 2-gram の Dice 係数（0〜1）。 */
export function diceSimilarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return (2 * common) / (x.size + y.size);
}

/** a の 2-gram のうち、b に文字列として含まれるものの割合（0〜1）。 */
export function bigramContainment(a: string, b: string): number {
  const x = bigrams(a);
  if (x.size === 0) return 0;
  let found = 0;
  for (const g of x) if (b.includes(g)) found++;
  return found / x.size;
}
