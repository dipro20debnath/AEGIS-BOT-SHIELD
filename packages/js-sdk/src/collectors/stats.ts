export function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function std(values: number[], avg = mean(values)): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / values.length);
}

/** Shannon entropy (bits) of values grouped into fixed-width bins. */
export function binnedEntropy(values: number[], binWidth: number): number {
  if (values.length === 0) return 0;
  const bins = new Map<number, number>();
  for (const v of values) {
    const bin = Math.floor(v / binWidth);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of bins.values()) {
    const p = count / values.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
