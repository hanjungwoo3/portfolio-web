// 🧪 시험 — 한국투자 해외주식 체결 조회에 매수·매도 구분(또는 체결강도)이 오는지(사용자 2026-11-21 "앱 미리보기에 시험 코드를 넣어 확인").
//   앱 + 한국투자 연동일 때만 보인다. 조회(GET)만 — 결과는 필드 이름과 앞 3줄을 그대로 보여 주고 복사할 수 있다.
//   확인이 끝나면(국내처럼 거슬러 채우기 가능/불가) 이 파일은 지운다.
import { useState } from "react";
import { kisGet, isKisLinkOn } from "../lib/broker";

const TESTS: { name: string; path: string; tr: string; params: Record<string, string> }[] = [
  { name: "체결추이(inquire-ccnl)", path: "/uapi/overseas-price/v1/quotations/inquire-ccnl", tr: "HHDFS76200300",
    params: { EXCD: "NAS", AUTH: "", KEYB: "", TDAY: "1", SYMB: "MU" } },
  { name: "분봉(inquire-time-itemchartprice)", path: "/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice", tr: "HHDFS76950200",
    params: { AUTH: "", EXCD: "NAS", SYMB: "MU", NMIN: "1", PINC: "1", NEXT: "", NREC: "5", FILL: "", KEYB: "" } },
  { name: "현재가상세(price-detail)", path: "/uapi/overseas-price/v1/quotations/price-detail", tr: "HHDFS76200200",
    params: { AUTH: "", EXCD: "NAS", SYMB: "MU" } },
];

export function KisUsProbe() {
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);
  if (!isKisLinkOn()) return null;
  const run = async () => {
    setBusy(true);
    const lines: string[] = [];
    for (const t of TESTS) {
      try {
        const { body } = await kisGet<Record<string, unknown> & { rt_cd?: string }>(t.path, t.tr, t.params);
        lines.push(`■ ${t.name} — OK`);
        for (const [k, v] of Object.entries(body)) {
          if (Array.isArray(v)) {
            lines.push(`  ${k}[] ${v.length}줄 · 필드: ${Object.keys(v[0] ?? {}).join(", ")}`);
            v.slice(0, 3).forEach(r => lines.push(`    ${JSON.stringify(r)}`));
          } else if (v && typeof v === "object") {
            lines.push(`  ${k}: ${JSON.stringify(v)}`);
          } else lines.push(`  ${k}: ${String(v)}`);
        }
      } catch (e) {
        lines.push(`■ ${t.name} — 실패: ${(e as Error).message}`);
      }
      setOut(lines.join("\n"));
    }
    setBusy(false);
  };
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11.5px]">
      <div className="flex items-center gap-2">
        <b className="text-amber-800">🧪 한투 해외 체결 시험(MU)</b>
        <span className="text-amber-700">매수·매도 구분이 오는지 확인용 — 조회만</span>
        <button type="button" disabled={busy} onClick={run} className="ml-auto px-2 py-0.5 rounded border border-amber-400 bg-white font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">{busy ? "조회 중…" : "시험하기"}</button>
        {out && <button type="button" onClick={() => void navigator.clipboard.writeText(out)} className="px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100">결과 복사</button>}
      </div>
      {out && <pre className="mt-1 max-h-[320px] overflow-auto whitespace-pre-wrap break-all text-[10.5px] text-gray-800 font-mono">{out}</pre>}
    </div>
  );
}
