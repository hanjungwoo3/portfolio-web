// 🧪 시험 — 한국투자 해외주식 체결 조회에 매수·매도 구분(또는 체결강도)이 오는지(사용자 2026-11-21 "앱 미리보기에 시험 코드를 넣어 확인").
//   앱 + 한국투자 연동일 때만 보인다. 조회(GET)만 — 결과는 필드 이름과 앞 3줄을 그대로 보여 주고 복사할 수 있다.
//   확인이 끝나면(국내처럼 거슬러 채우기 가능/불가) 이 파일은 지운다.
import { useState } from "react";
import { kisGet, isKisLinkOn } from "../lib/broker";


type Ccnl = { khms?: string; vpow?: string; tvol?: string; evol?: string; last?: string };
// 2차 시험(사용자 2026-11-21 1차 결과: 체결추이에 vpow·tvol 이 온다) — ① KEYB 로 시각을 건너뛸 수 있나 ② 다음 쪽(tr_cont N) ③ vpow 소수점
async function ccnl(keyb: string, trCont = "") {
  const r = await kisGet<{ rt_cd?: string; output1?: Record<string, string>; output2?: Ccnl[] }>("/uapi/overseas-price/v1/quotations/inquire-ccnl", "HHDFS76200300",
    { EXCD: "NAS", AUTH: "", KEYB: keyb, TDAY: "1", SYMB: "MU" }, trCont);
  const rows = r.body.output2 ?? [];
  const f = rows[0], l = rows[rows.length - 1];
  const vp = [...new Set(rows.map(x => x.vpow))].slice(0, 8).join(" / ");
  return { line: `${rows.length}줄 · 처음 ${f?.khms} tvol ${f?.tvol} vpow ${f?.vpow} → 끝 ${l?.khms} tvol ${l?.tvol} vpow ${l?.vpow} · trCont(응답) "${r.trCont}" · output1 ${JSON.stringify(r.body.output1)}\n      vpow 값들: ${vp}`, last: l?.khms ?? "", trCont: r.trCont };
}
const kstMinus = (min: number) => { const d = new Date(Date.now() + 9 * 3600_000 - min * 60_000); return d.toISOString().slice(11, 19).replace(/:/g, ""); };

export function KisUsProbe() {
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);
  if (!isKisLinkOn()) return null;
  const run = async () => {
    setBusy(true);
    const lines: string[] = [];
    const step = async (label: string, f: () => Promise<{ line: string }>) => {
      try { lines.push(`■ ${label}\n   ${(await f()).line}`); } catch (e) { lines.push(`■ ${label} — 실패: ${(e as Error).message}`); }
      setOut(lines.join("\n"));
    };
    let first: Awaited<ReturnType<typeof ccnl>> | null = null;
    await step("① 기본(KEYB 비움)", async () => (first = await ccnl("")));
    await step("② 다음 쪽(KEYB=①의 마지막 시각, tr_cont N)", () => ccnl(first?.last ?? "", "N"));
    await step("③ 다음 쪽(KEYB=①의 마지막 시각, tr_cont 없음)", () => ccnl(first?.last ?? ""));
    await step(`④ 30분 전으로 건너뛰기(KEYB=${kstMinus(30)})`, () => ccnl(kstMinus(30)));
    await step(`⑤ 30분 전 + tr_cont N`, () => ccnl(kstMinus(30), "N"));
    await step(`⑥ 2시간 전으로 건너뛰기(KEYB=${kstMinus(120)})`, () => ccnl(kstMinus(120), "N"));
    setBusy(false);
  };
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11.5px]">
      <div className="flex items-center gap-2">
        <b className="text-amber-800">🧪 한투 해외 체결 시험 2차(MU)</b>
        <span className="text-amber-700">시각 건너뛰기·다음 쪽·체결강도 소수점 확인 — 조회만(6번 호출)</span>
        <button type="button" disabled={busy} onClick={run} className="ml-auto px-2 py-0.5 rounded border border-amber-400 bg-white font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">{busy ? "조회 중…" : "시험하기"}</button>
        {out && <button type="button" onClick={() => void navigator.clipboard.writeText(out)} className="px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100">결과 복사</button>}
      </div>
      {out && <pre className="mt-1 max-h-[320px] overflow-auto whitespace-pre-wrap break-all text-[10.5px] text-gray-800 font-mono">{out}</pre>}
    </div>
  );
}
