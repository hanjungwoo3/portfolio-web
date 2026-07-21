// Squarified treemap 레이아웃 (Bruls et al. 2000) — 타일 종횡비를 1에 가깝게.
//   값(value)에 비례한 면적으로 rect 안에 타일 배치. 순수 계산(픽셀 좌표 반환).
export interface Rect { x: number; y: number; w: number; h: number }
export interface TmInput<T> { item: T; value: number }
export interface Tile<T> { item: T; x: number; y: number; w: number; h: number }

function worst(areas: number[], side: number): number {
  if (areas.length === 0 || side <= 0) return Infinity;
  let sum = 0, mn = Infinity, mx = 0;
  for (const a of areas) { sum += a; if (a < mn) mn = a; if (a > mx) mx = a; }
  const s2 = sum * sum, side2 = side * side;
  return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
}

function layoutRow<T>(row: { item: T; area: number }[], rect: Rect, horizontal: boolean, out: Tile<T>[]): number {
  const rowArea = row.reduce((a, b) => a + b.area, 0);
  if (rowArea <= 0) return 0;
  if (horizontal) {            // 가로 행: 위쪽에 폭 rect.w, 두께=rowArea/w
    const rowH = rowArea / rect.w;
    let cx = rect.x;
    for (const r of row) { const tw = r.area / rowH; out.push({ item: r.item, x: cx, y: rect.y, w: tw, h: rowH }); cx += tw; }
    return rowH;
  } else {                     // 세로 열: 왼쪽에 높이 rect.h, 두께=rowArea/h
    const rowW = rowArea / rect.h;
    let cy = rect.y;
    for (const r of row) { const th = r.area / rowW; out.push({ item: r.item, x: rect.x, y: cy, w: rowW, h: th }); cy += th; }
    return rowW;
  }
}

export function squarify<T>(data: TmInput<T>[], rect: Rect): Tile<T>[] {
  const out: Tile<T>[] = [];
  const items = data.filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((s, d) => s + d.value, 0);
  if (items.length === 0 || total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  const vals = items.map(d => ({ item: d.item, area: d.value * scale }));

  let { x, y, w, h } = rect;
  let row: { item: T; area: number }[] = [];
  let i = 0;
  while (i < vals.length) {
    const side = Math.min(w, h);
    const cur = row.map(r => r.area);
    const next = vals[i];
    if (row.length === 0 || worst([...cur, next.area], side) <= worst(cur, side)) {
      row.push(next); i++;
    } else {
      // 짧은 변이 w(세로로 긴 rect)면 폭 전체 가로 밴드로, 짧은 변이 h면 높이 전체 세로 열로 채움.
      const horizontal = side === w;
      const thick = layoutRow(row, { x, y, w, h }, horizontal, out);
      if (horizontal) { y += thick; h -= thick; } else { x += thick; w -= thick; }
      row = [];
    }
  }
  if (row.length) {
    const horizontal = Math.min(w, h) === w;
    const thick = layoutRow(row, { x, y, w, h }, horizontal, out);
    if (horizontal) { y += thick; h -= thick; } else { x += thick; w -= thick; }
  }
  return out;
}
