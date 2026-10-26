// 설정 → 증권사 연결 → 한국투자증권(KIS Developers). 토스 칸(BrokerLinkSection)과 같은 흐름: 키 저장(OS 보관함, 앱만) → 연결 시험 →
//   연동 그룹(기본 '한국투자', 📁증권사연결) → 보유·예수금·거래 자동 갱신. 웹·휴대폰은 안내만(결과는 Drive 동기화로 온다).
//   키: KIS Developers(apiportal.koreainvestment.com) 앱 등록 → 앱키·앱시크릿. 실전/모의 키가 다르고 모의는 별도 모의계좌.
//   계좌: 종합계좌번호 8자리 + 상품코드 2자리(위탁 01·연금 22/29).
import { useEffect, useState } from "react";
import {
  isBrokerAvailable, brokerStatus, brokerSet, brokerClear, BrokerError, kisGet,
  getKisEnabled, setKisEnabled, getKisAccount, setKisAccount, getKisMode, setKisMode, type KisMode,
} from "../lib/broker";
import { linkedGroupOf, setLinkedGroup, removeLinkedGroup, ensureLinkedGroupsInFolder, DEFAULT_KIS_GROUP, LINKED_GROUPS_EVENT } from "../lib/linkedGroups";
import { syncKisHoldingsSafe, KIS_SOURCE } from "../lib/kisSync";
import { unlockSyncedHoldingsOfGroup } from "../lib/db";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { appConfirm } from "../lib/appDialog";

export function KisLinkSection({ compact }: { compact?: boolean }) {
  const available = isBrokerAvailable();
  const [configured, setConfigured] = useState(false);
  const [hint, setHint] = useState("");
  const [enabled, setEnabled] = useState(getKisEnabled());
  const [mode, setModeState] = useState<KisMode>(getKisMode());
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [cano, setCano] = useState(getKisAccount().cano);
  const [prdt, setPrdt] = useState(getKisAccount().prdt);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState(() => linkedGroupOf("kis"));
  const [groupName, setGroupName] = useState(DEFAULT_KIS_GROUP);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [probe, setProbe] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setLink(linkedGroupOf("kis"));
    window.addEventListener(LINKED_GROUPS_EVENT, h);
    return () => window.removeEventListener(LINKED_GROUPS_EVENT, h);
  }, []);
  const refresh = async () => {
    if (!available) return;
    try {
      const s = await brokerStatus("kis");
      setConfigured(s.configured); setHint(s.clientIdHint);
      if (s.mode) { setModeState(s.mode); setKisMode(s.mode); }
    } catch { /* 보관함 접근 실패 — 미연결로 */ }
  };
  useEffect(() => { void refresh(); }, [available]);   // eslint-disable-line react-hooks/exhaustive-deps

  const saveAccount = () => { setKisAccount(cano, prdt); const a = getKisAccount(); setCano(a.cano); setPrdt(a.prdt); return a; };

  // 연결 시험 — 국내 잔고 1페이지(가장 기본 조회). 토큰 발급은 1분에 1번이라 실패해도 바로 다시 누르지 않게 안내
  const test = async () => {
    const a = saveAccount();
    if (!/^\d{8}$/.test(a.cano)) { setMsg({ ok: false, text: "종합계좌번호 8자리를 넣어 주세요" }); return false; }
    setBusy(true); setMsg(null);
    try {
      const { body } = await kisGet<{ rt_cd?: string; output1?: unknown[]; output2?: Array<{ dnca_tot_amt?: string; tot_evlu_amt?: string }> }>(
        "/uapi/domestic-stock/v1/trading/inquire-balance", "TTTC8434R",
        { CANO: a.cano, ACNT_PRDT_CD: a.prdt, AFHR_FLPR_YN: "N", OFL_YN: "", INQR_DVSN: "02", UNPR_DVSN: "01", FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00", CTX_AREA_FK100: "", CTX_AREA_NK100: "" });
      const n = body.output1?.length ?? 0;
      const cash = Number(body.output2?.[0]?.dnca_tot_amt ?? 0);
      setMsg({ ok: true, text: `연결됐습니다(${mode === "paper" ? "모의" : "실전"}) — 보유 ${n}종목 · 예수금 ${cash.toLocaleString()}원` });
      setProbe(JSON.stringify(body, null, 1).slice(0, 4000));
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof BrokerError ? e.message : `연결 실패: ${String(e instanceof Error ? e.message : e)}` });
      return false;
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!appKey.trim() || !appSecret.trim()) { setMsg({ ok: false, text: "앱키와 앱시크릿을 모두 넣어 주세요" }); return; }
    setBusy(true); setMsg(null);
    try {
      setKisMode(mode);
      await brokerSet("kis", appKey.trim(), appSecret.trim(), mode);
      setAppKey(""); setAppSecret(""); setEditing(false);
      await refresh();
      const ok = await test();
      if (ok) {
        if (getIndependentGroupsMode()) { setKisEnabled(true); setEnabled(true); }
        else setMsg({ ok: true, text: "연결됐습니다. 연동을 켜려면 먼저 설정 아래쪽의 '그룹별 독립 보유 모드'를 켜 주세요." });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const clear = async () => {
    if (!(await appConfirm("한국투자 키를 이 PC 에서 지울까요? (연동 그룹은 남고 갱신만 멈춥니다)"))) return;
    setBusy(true);
    try { await brokerClear("kis"); setKisEnabled(false); setEnabled(false); await refresh(); setMsg({ ok: true, text: "키를 지웠습니다" }); }
    finally { setBusy(false); }
  };
  const toggleEnabled = () => {
    if (!enabled && !getIndependentGroupsMode()) { setMsg({ ok: false, text: "먼저 '그룹별 독립 보유 모드'를 켜 주세요" }); return; }
    setKisEnabled(!enabled); setEnabled(!enabled);
  };
  const runSync = async () => {
    setBusy(true); setSyncMsg(null);
    try {
      const r = await syncKisHoldingsSafe();
      if (r) setSyncMsg({ ok: true, text: `갱신됐습니다 — ${r.group}: 종목 ${r.count}개 · 예수금 ${r.cash.toLocaleString()}원${r.trades ? ` · 새 거래 ${r.trades}건` : ""}` });
      else setSyncMsg({ ok: false, text: "연동이 꺼져 있거나 연동 그룹이 없습니다" });
    } catch (e) { setSyncMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const startLink = async () => {
    const g = groupName.trim();
    if (!g) { setSyncMsg({ ok: false, text: "그룹 이름을 넣어 주세요" }); return; }
    if (!getIndependentGroupsMode()) { setSyncMsg({ ok: false, text: "먼저 '그룹별 독립 보유 모드'를 켜 주세요" }); return; }
    const a = saveAccount();
    if (!/^\d{8}$/.test(a.cano)) { setSyncMsg({ ok: false, text: "종합계좌번호 8자리를 넣어 주세요" }); return; }
    if (!(await appConfirm(`"${g}" 그룹을 한국투자 계좌(${a.cano}-${a.prdt})의 연동 그룹으로 쓸까요?\n\n· 한국투자 보유 종목이 이 그룹에 들어오고 자동 갱신됩니다(수정·삭제 불가)\n· 손으로 넣은 종목은 그대로 둡니다\n· 예수금은 주문가능현금으로 고정됩니다`))) return;
    setLinkedGroup(g, { broker: "kis", accountSeq: `${a.cano}-${a.prdt}` });
    ensureLinkedGroupsInFolder();
    setKisEnabled(true); setEnabled(true);
    await runSync();
  };
  const unlink = async () => {
    if (!link) return;
    if (!(await appConfirm(`"${link.group}" 의 한국투자 연동을 해제할까요?\n보유 종목은 남고 잠금만 풀립니다.`))) return;
    setBusy(true);
    try { await unlockSyncedHoldingsOfGroup(link.group, KIS_SOURCE); removeLinkedGroup(link.group); setSyncMsg({ ok: true, text: "연동을 해제했습니다 — 보유는 그대로 남았습니다" }); }
    finally { setBusy(false); }
  };
  const fmtAt = (iso?: string) => iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  const inputCls = "w-full border rounded px-2 py-1 text-[11px] font-mono";
  const btn = "px-2 py-1 rounded text-[11px] font-semibold disabled:opacity-50";

  return (
    <div className={`rounded-lg border border-sky-200 bg-sky-50/60 ${compact ? "p-2" : "p-3"} space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-sky-900 text-[12px]">🏦 한국투자증권 Open API</div>
        {available && configured && (
          <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={toggleEnabled} /> 연동 사용
          </label>
        )}
      </div>
      {!available ? (
        <div className="text-[11px] text-gray-600 leading-relaxed">
          한국투자 연결은 <b>데스크톱 앱(맥·윈도우)</b>에서만 됩니다 — 키가 PC 의 비밀 보관함에만 저장되기 때문입니다.
          앱에서 연결하면 보유·예수금·거래가 Drive 동기화로 여기에도 보입니다.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-gray-600 leading-relaxed">
            KIS Developers 에서 앱을 등록하고 <b>앱키·앱시크릿</b>을 받으세요. 실전/모의 키가 다릅니다. 조회만 하며(GET) 주문은 보내지 않습니다.
          </div>
          {/* 계좌·실전/모의 — 비밀 아님, 이 PC 에만 */}
          <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="text-gray-500">구분</span>
            <div className="flex rounded border border-gray-300 overflow-hidden w-fit">
              {(["real", "paper"] as const).map(m => (
                <button key={m} type="button" onClick={() => { setModeState(m); setKisMode(m); }}
                        className={`px-2 py-0.5 ${mode === m ? "bg-sky-600 text-white" : "bg-white text-gray-600"}`}>{m === "real" ? "실전" : "모의"}</button>
              ))}
            </div>
            <span className="text-gray-500">계좌</span>
            <div className="flex items-center gap-1">
              <input value={cano} onChange={e => setCano(e.target.value.replace(/\D/g, "").slice(0, 8))} onBlur={saveAccount} placeholder="종합계좌 8자리" className={`${inputCls} w-28`} />
              <span>-</span>
              <input value={prdt} onChange={e => setPrdt(e.target.value.replace(/\D/g, "").slice(0, 2))} onBlur={saveAccount} placeholder="01" className={`${inputCls} w-12`} />
            </div>
          </div>
          {configured && !editing ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-emerald-700 font-semibold">키 저장됨</span>
              {hint && <span className="text-gray-400 font-mono">{hint}…</span>}
              <button className={`${btn} bg-sky-600 text-white`} disabled={busy} onClick={() => void test()}>연결 시험</button>
              <button className={`${btn} bg-white border border-gray-300 text-gray-700`} disabled={busy} onClick={() => setEditing(true)}>키 바꾸기</button>
              <button className={`${btn} bg-white border border-rose-300 text-rose-600`} disabled={busy} onClick={() => void clear()}>연결 해제</button>
            </div>
          ) : (
            <div className="space-y-1">
              <input value={appKey} onChange={e => setAppKey(e.target.value)} placeholder="앱키(appkey)" className={inputCls} autoComplete="off" />
              <input value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder="앱시크릿(appsecret)" type="password" className={inputCls} autoComplete="off" />
              <div className="flex gap-2">
                <button className={`${btn} bg-sky-600 text-white`} disabled={busy} onClick={() => void save()}>저장하고 연결 시험</button>
                {configured && <button className={`${btn} bg-white border border-gray-300 text-gray-700`} onClick={() => setEditing(false)}>취소</button>}
              </div>
            </div>
          )}
          {msg && <div className={`text-[11px] ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.ok ? "✅" : "⚠️"} {msg.text}</div>}

          {configured && (
            <div className="rounded border border-sky-200 bg-white/70 p-2 text-[11px] space-y-1">
              {link ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-800">연동 그룹: 🔗 {link.group}</span>
                    <span className="text-gray-500">계좌 {link.meta.accountSeq}</span>
                    <span className="text-gray-500">마지막 갱신 {fmtAt(link.meta.lastSyncAt)}</span>
                    <button className={`${btn} bg-sky-600 text-white`} disabled={busy || !enabled} onClick={() => void runSync()}>지금 갱신</button>
                    <button className={`${btn} bg-white border border-rose-300 text-rose-600`} disabled={busy} onClick={() => void unlink()}>연동 그룹 해제</button>
                  </div>
                  {link.meta.lastError && <div className="text-rose-600">⚠️ 마지막 갱신 실패: {link.meta.lastError}</div>}
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-gray-700">연동 그룹 이름</span>
                  <input value={groupName} onChange={e => setGroupName(e.target.value)} className="border rounded px-2 py-0.5 text-[11px] w-28" />
                  <button className={`${btn} bg-sky-600 text-white`} disabled={busy} onClick={() => void startLink()}>연동 시작</button>
                  <span className="text-gray-400">📁 증권사연결 폴더에 들어갑니다</span>
                </div>
              )}
              {syncMsg && <div className={syncMsg.ok ? "text-emerald-700" : "text-rose-600"}>{syncMsg.ok ? "✅" : "⚠️"} {syncMsg.text}</div>}
            </div>
          )}
          {probe && (
            <details className="text-[10px]"><summary className="cursor-pointer text-gray-500">진단 — 잔고 응답(raw)</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-white/70 p-1 rounded border border-gray-200">{probe}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
