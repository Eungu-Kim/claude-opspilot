// 긴 노트를 임베딩 컨텍스트에 맞게 겹치는 청크로 분할.
// 한국어 토큰 밀도 감안 ~1200자(≈컨텍스트 내), 청크 간 overlap 으로 경계 손실 완화.

const MAX_LEN = 1200;
const OVERLAP = 150;

export function chunkText(text: string, maxLen = MAX_LEN, overlap = OVERLAP): string[] {
  const t = text.trim();
  if (t.length <= maxLen) return t.length ? [t] : [];

  const chunks: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(t.length, start + maxLen);
    // 문단/문장/공백 경계에서 자르기 (뒷부분에서 가장 가까운 경계)
    if (end < t.length) {
      const slice = t.slice(start, end);
      const brk = Math.max(
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf(" ")
      );
      if (brk > maxLen * 0.5) end = start + brk + 1;
    }
    const piece = t.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= t.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}
