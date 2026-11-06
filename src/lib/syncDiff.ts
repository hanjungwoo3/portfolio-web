// 동기화 지문(normalize 결과 JSON) 두 개를 비교해 '무엇이 바뀌었나'를 사람 말로 — 충돌 배너에 띄운다
//   (사용자 2026-11-07 "아무것도 수정 안 해도 구글드라이브가 갱신되었다고 뜨는데… 앱에서 뭔가를 자동 업데이트하는 거 같아").
//   추측으로 막지 않고 실제 바뀐 항목을 보여 줘서 범인을 화면에서 바로 찾게 한다.
type Norm = {
  holdings?: { ticker: string; account: string; shares: number; avg_price: number; name?: string; buy_date?: string; market?: string; source?: string }[];
  memos?: { ticker: string }[];
  trades?: { id: string; ticker: string; amount: number; qty: number }[];
  settings?: Record<string, unknown> & { deposits?: Record<string, number> };
};
const parse = (s: string | null | undefined): Norm | null => { try { return s ? JSON.parse(s) as Norm : null; } catch { return null; } };
const won = (v: number) => Math.round(v).toLocaleString();

/** base → next 로 바뀐 것(최대 limit 줄) */
export function describeNormDiff(base: string | null | undefined, next: string | null | undefined, limit = 6): string[] {
  const a = parse(base), b = parse(next);
  if (!a || !b) return [];
  const out: string[] = [];
  // 보유
  const key = (h: { ticker: string; account: string }) => `${h.account}|${h.ticker}`;
  const ha = new Map((a.holdings ?? []).map(h => [key(h), h])), hb = new Map((b.holdings ?? []).map(h => [key(h), h]));
  for (const [k, h] of hb) {
    const o = ha.get(k);
    if (!o) { out.push(`보유 추가 ${h.account} ${h.name ?? h.ticker}`); continue; }
    const f: string[] = [];
    if (o.shares !== h.shares) f.push(`수량 ${o.shares}→${h.shares}`);
    if (o.avg_price !== h.avg_price) f.push(`평단 ${won(o.avg_price)}→${won(h.avg_price)}`);
    if ((o.name ?? "") !== (h.name ?? "")) f.push(`이름 ${o.name}→${h.name}`);
    if ((o.buy_date ?? "") !== (h.buy_date ?? "")) f.push(`매수일 ${o.buy_date || "-"}→${h.buy_date || "-"}`);
    if ((o.market ?? "") !== (h.market ?? "")) f.push(`시장 ${o.market || "-"}→${h.market || "-"}`);
    if ((o.source ?? "") !== (h.source ?? "")) f.push(`연동 ${o.source || "-"}→${h.source || "-"}`);
    if (f.length) out.push(`보유 ${h.account} ${h.name ?? h.ticker}: ${f.join(", ")}`);
  }
  for (const [k, h] of ha) if (!hb.has(k)) out.push(`보유 삭제 ${h.account} ${h.name ?? h.ticker}`);
  // 거래
  const ta = new Map((a.trades ?? []).map(t => [t.id, t])), tb = new Map((b.trades ?? []).map(t => [t.id, t]));
  const addT = [...tb.keys()].filter(k => !ta.has(k)).length, delT = [...ta.keys()].filter(k => !tb.has(k)).length;
  const chT = [...tb].filter(([k, t]) => { const o = ta.get(k); return o && JSON.stringify(o) !== JSON.stringify(t); });
  if (addT) out.push(`거래 추가 ${addT}건`);
  if (delT) out.push(`거래 삭제 ${delT}건`);
  if (chT.length) out.push(`거래 변경 ${chT.length}건(예: ${chT[0][1].ticker} 금액 ${won(ta.get(chT[0][0])!.amount)}→${won(chT[0][1].amount)})`);
  // 메모
  if (JSON.stringify(a.memos ?? []) !== JSON.stringify(b.memos ?? [])) out.push("메모 변경");
  // 설정 — 예수금은 그룹별로, 나머지는 키 이름
  const da = a.settings?.deposits ?? {}, db = b.settings?.deposits ?? {};
  for (const g of new Set([...Object.keys(da), ...Object.keys(db)])) if ((da[g] ?? 0) !== (db[g] ?? 0)) out.push(`예수금 ${g}: ${won(da[g] ?? 0)}→${won(db[g] ?? 0)}`);
  const sa = a.settings ?? {}, sb = b.settings ?? {};
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (k === "deposits") continue;
    if (JSON.stringify(sa[k] ?? null) !== JSON.stringify(sb[k] ?? null)) out.push(`설정 ${k} 변경`);
  }
  return out.length > limit ? [...out.slice(0, limit), `… 외 ${out.length - limit}건`] : out;
}
