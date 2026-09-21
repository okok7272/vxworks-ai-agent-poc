export interface EvidenceOptions {
  prefix?: 'demo-run';
  baseline?: string;
  summariesOnly?: boolean;
  runDescription?: string;
}
export function compactDiff(before: string, after: string): string {
  const a = before.trimEnd().split('\n'), b = after.trimEnd().split('\n');
  let first = 0, endA = a.length, endB = b.length;
  while (first < endA && first < endB && a[first] === b[first]) { first++; }
  while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return '--- a/main.c\n+++ b/main.c\n@@ -' + (first + 1) + ',' + (endA - first) + ' +' + (first + 1) + ',' + (endB - first) + ' @@\n' +
    a.slice(first, endA).map(s => '-' + s + '\n').join('') + b.slice(first, endB).map(s => '+' + s + '\n').join('');
}
