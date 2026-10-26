// 설정 → 증권사 연결(토스증권 Open API). PC 설정·모바일 설정이 같이 쓴다.
//   데스크톱 앱에서만 실제로 연결된다(키는 OS 비밀 보관함, 조회만). 웹·안드로이드는 안내만.
//   계획서: docs/broker-api-integration-plan.md — 1단계(키 저장·연결 시험)
import { useEffect, useState } from "react";
import {
  isBrokerAvailable, brokerStatus, brokerSet, brokerClear, fetchTossAccounts, brokerGet,
  getTossEnabled, setTossEnabled, getTossAccountSeq, setTossAccountSeq, maskAccountNo,
  BrokerError, type TossAccount,
} from "../lib/broker";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { appConfirm } from "../lib/appDialog";
import { linkedGroupOf, setLinkedGroup, removeLinkedGroup, DEFAULT_TOSS_GROUP, LINKED_GROUPS_EVENT } from "../lib/linkedGroups";
import { syncTossHoldingsSafe, TOSS_SOURCE } from "../lib/tossSync";
import { unlockSyncedHoldingsOfGroup } from "../lib/db";

const APPS_RELEASE = "https://github.com/hanjungwoo3/portfolio-web/releases/tag/apps";

export function BrokerLinkSection({ compact }: { compact?: boolean }) {
  const available = isBrokerAvailable();
  const [configured, setConfigured] = useState(false);
  const [hint, setHint] = useState("");
  const [enabled, setEnabled] = useState(getTossEnabled());
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [accounts, setAccounts] = useState<TossAccount[] | null>(null);
  const [accountSeq, setAccountSeqState] = useState(getTossAccountSeq());
  // 연동 그룹 — 토스 보유·예수금의 거울. 메타는 linkedGroups(Drive 동기화 포함)
  const [link, setLink] = useState(() => linkedGroupOf("toss"));
  const [groupName, setGroupName] = useState(DEFAULT_TOSS_GROUP);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const h = () => setLink(linkedGroupOf("toss"));
    window.addEventListener(LINKED_GROUPS_EVENT, h);
    return () => window.removeEventListener(LINKED_GROUPS_EVENT, h);
  }, []);
  const runSync = async () => {
    setBusy(true); setSyncMsg(null);
    try {
      const r = await syncTossHoldingsSafe();
      if (r) setSyncMsg({ ok: true, text: `갱신됐습니다 — ${r.group}: 종목 ${r.count}개 · 예수금 ${r.cash.toLocaleString()}원${r.fxUsed ? ` · 환율 ${r.fxUsed.toFixed(1)}` : ""}` });
      else setSyncMsg({ ok: false, text: "연동이 꺼져 있거나 연동 그룹이 없습니다" });
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const startLink = async () => {
    const g = groupName.trim();
    if (!g) { setSyncMsg({ ok: false, text: "그룹 이름을 넣어 주세요" }); return; }
    if (!getIndependentGroupsMode()) { setSyncMsg({ ok: false, text: "먼저 설정 아래쪽의 '그룹별 독립 보유 모드'를 켜 주세요 — 꺼져 있으면 같은 종목이 모든 그룹에 같은 값으로 맞춰져 토스 값이 수동 그룹까지 덮습니다." }); return; }
    if (!accountSeq) { setSyncMsg({ ok: false, text: "먼저 '연결 시험'으로 계좌를 확인해 주세요" }); return; }
    if (!(await appConfirm(`"${g}" 그룹을 토스 계좌의 연동 그룹으로 쓸까요?\n\n· 토스 보유 종목이 이 그룹에 들어오고 토스 값으로 자동 갱신됩니다(수정·삭제 불가)\n· 이 그룹에 손으로 넣은 종목은 그대로 둡니다. 토스에도 있는 종목이면 토스 값으로 바뀝니다\n· 예수금은 토스 '주문 가능 금액'으로 고정됩니다`))) return;
    setLinkedGroup(g, { broker: "toss", accountSeq });
    setTossEnabled(true); setEnabled(true);
    await runSync();
  };
  const unlink = async () => {
    if (!link) return;
    if (!(await appConfirm(`"${link.group}" 의 토스 연동을 해제할까요?\n보유 종목은 남고 잠금만 풀립니다(이후엔 손으로 관리).`))) return;
    setBusy(true);
    try {
      await unlockSyncedHoldingsOfGroup(link.group, TOSS_SOURCE);
      removeLinkedGroup(link.group);
      setSyncMsg({ ok: true, text: "연동을 해제했습니다 — 보유는 그대로 남았습니다" });
    } finally { setBusy(false); }
  };
  const fmtAt = (iso?: string) => iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  // 진단 — 응답을 그대로 보여 준다(2단계 설계용 실측: 필드·통화·체결 모양). 계좌번호 등은 사용자 본인 화면에만
  const [probeOpen, setProbeOpen] = useState(false);
  const [probe, setProbe] = useState<{ label: string; text: string } | null>(null);
  const runProbe = async (label: string, path: string) => {
    setBusy(true); setProbe({ label, text: "불러오는 중…" });
    try {
      const r = await brokerGet<unknown>("toss", path, accountSeq || undefined);
      const text = JSON.stringify(r, null, 1);
      setProbe({ label, text: text.length > 6000 ? text.slice(0, 6000) + "\n… (잘림)" : text });
    } catch (e) {
      setProbe({ label, text: `오류: ${e instanceof Error ? e.message : String(e)}` });
    } finally { setBusy(false); }
  };
  const PROBES: [string, string][] = [
    ["보유", "/api/v1/holdings"],
    ["최근 종료 주문 5건", "/api/v1/orders?status=CLOSED&limit=5"],
    ["대기 주문", "/api/v1/orders?status=OPEN"],
    ["매수 가능(KRW)", "/api/v1/buying-power?currency=KRW"],
    ["매수 가능(USD)", "/api/v1/buying-power?currency=USD"],
    ["수수료", "/api/v1/commissions"],
  ];

  const refresh = async () => {
    if (!available) return;
    try {
      const s = await brokerStatus("toss");
      setConfigured(s.configured); setHint(s.clientIdHint);
    } catch { /* 보관함 접근 실패 — 미연결로 */ }
  };
  useEffect(() => { void refresh(); }, [available]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 연결 시험 — 계좌 목록을 받아 본다(계좌 API 는 X-Tossinvest-Account 없이 되는 유일한 것)
  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const list = await fetchTossAccounts();
      setAccounts(list);
      if (list.length && !list.some(a => String(a.accountSeq) === accountSeq)) {
        const seq = String(list[0].accountSeq);
        setAccountSeqState(seq); setTossAccountSeq(seq);
      }
      setMsg({ ok: true, text: `연결됐습니다 — 계좌 ${list.length}개` });
      return true;
    } catch (e) {
      const text = e instanceof BrokerError ? e.message : `연결 실패: ${String(e instanceof Error ? e.message : e)}`;
      setMsg({ ok: false, text });
      return false;
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!clientId.trim() || !clientSecret.trim()) { setMsg({ ok: false, text: "client_id 와 client_secret 을 모두 넣어 주세요" }); return; }
    setBusy(true); setMsg(null);
    try {
      await brokerSet("toss", clientId.trim(), clientSecret.trim());
      setClientId(""); setClientSecret(""); setEditing(false);
      await refresh();
      const ok = await test();
      // 연결되면 바로 켠다 — 단, 그룹 독립 모드가 꺼져 있으면 켜지 않고 안내만(아래 toggleEnabled 와 같은 이유)
      if (ok) {
        if (getIndependentGroupsMode()) { setTossEnabled(true); setEnabled(true); }
        else setMsg({ ok: true, text: "연결됐습니다. 연동을 켜려면 먼저 설정 아래쪽의 '그룹별 독립 보유 모드'를 켜 주세요 — 꺼져 있으면 토스에서 가져온 값이 수동 그룹까지 덮습니다." });
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e instanceof Error ? e.message : e) });
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!(await appConfirm("토스 연결을 해제할까요?\n저장된 키와 토큰을 이 PC 에서 지웁니다. (토스 쪽 키는 WTS 설정 > Open API 에서 따로 폐기하세요)"))) return;
    setBusy(true);
    try {
      await brokerClear("toss");
      setTossEnabled(false); setEnabled(false); setAccounts(null); setMsg(null);
      await refresh();
    } finally { setBusy(false); }
  };

  const toggleEnabled = (on: boolean) => {
    if (on && !getIndependentGroupsMode()) {
      // 연동 그룹이 다른 그룹과 자동으로 맞춰지면 수동 값이 덮인다(검토 2026-10-26) — 독립 모드가 켜져 있어야 한다
      setMsg({ ok: false, text: "먼저 설정 아래쪽의 '그룹별 독립 보유 모드'를 켜 주세요 — 꺼져 있으면 같은 종목이 모든 그룹에 같은 값으로 맞춰져, 토스에서 가져온 값이 수동 그룹까지 덮습니다." });
      return;
    }
    setTossEnabled(on); setEnabled(on);
  };

  const box = "border border-gray-200 rounded p-2.5 bg-violet-50/30 space-y-1.5";
  const title = <div className="text-xs font-bold text-gray-700">🏦 증권사 연결 — 토스증권 Open API <span className="ml-1 text-[10px] font-normal text-violet-700">조회 전용</span></div>;

  if (!available) {
    return (
      <div className={box}>
        {title}
        <p className="text-[11px] text-gray-600 leading-snug">
          <b>맥·윈도우 앱에서만</b> 연결할 수 있습니다. 키는 그 PC 의 비밀 보관함(키체인·자격 증명 관리자)에만 저장되고, 앱이 직접 토스에 조회합니다 —
          브라우저·휴대폰에는 키가 가지 않습니다. 앱에서 가져온 보유·거래는 지금처럼 구글 드라이브 동기화로 여기서도 보입니다.
        </p>
        {!compact && (
          <a href={APPS_RELEASE} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 underline">데스크톱 앱 받기 ↗</a>
        )}
      </div>
    );
  }

  return (
    <div className={box}>
      {title}
      <p className="text-[11px] text-gray-600 leading-snug">
        토스증권 웹(WTS) → 설정 → <b>Open API</b> 에서 키를 발급하고, <b>허용 IP 에 이 PC 의 공인 IP</b> 를 등록한 뒤 아래에 넣어 주세요.
        키는 이 PC 의 비밀 보관함에만 저장되며 <b>조회만</b> 합니다(주문 불가).
      </p>

      {/* 상태 줄 */}
      <div className="text-[11px] flex items-center gap-2 flex-wrap">
        {configured ? (
          <>
            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">키 저장됨</span>
            <span className="text-gray-500 font-mono">{hint}••••</span>
            <label className="inline-flex items-center gap-1 cursor-pointer select-none ml-1">
              <input type="checkbox" checked={enabled} onChange={e => toggleEnabled(e.target.checked)} className="w-3.5 h-3.5 accent-violet-600" />
              <span className="text-gray-700">연동 사용</span>
            </label>
            <button onClick={() => void test()} disabled={busy}
                    className="px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">연결 시험</button>
            <button onClick={() => { setEditing(v => !v); setMsg(null); }} disabled={busy}
                    className="px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">{editing ? "취소" : "키 바꾸기"}</button>
            <button onClick={() => void disconnect()} disabled={busy}
                    className="px-2 py-0.5 rounded border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50">연결 해제</button>
          </>
        ) : (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">미연결</span>
        )}
      </div>

      {/* 키 입력 — 미연결이거나 '키 바꾸기' 눌렀을 때 */}
      {(!configured || editing) && (
        <div className="space-y-1">
          <input type="text" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="client_id" autoComplete="off" spellCheck={false}
                 className="w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-violet-500" />
          <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="client_secret" autoComplete="new-password"
                 className="w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-violet-500" />
          <div className="flex items-center gap-2">
            <button onClick={() => void save()} disabled={busy}
                    className="px-3 py-1 rounded bg-violet-600 hover:bg-violet-700 text-white text-xs disabled:opacity-50">
              {busy ? "확인 중…" : "저장하고 연결 시험"}
            </button>
            <span className="text-[10px] text-gray-500">저장하면 입력칸은 비워지고 다시 보여 주지 않습니다</span>
          </div>
        </div>
      )}

      {msg && <div className={`text-[11px] ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.ok ? "✅ " : "⚠️ "}{msg.text}</div>}

      {/* 계좌 — 여러 개면 고른다(이후 보유·거래 조회에 쓸 계좌) */}
      {accounts && accounts.length > 0 && (
        <div className="text-[11px] flex items-center gap-2 flex-wrap">
          <span className="text-gray-600">계좌</span>
          <select value={accountSeq} onChange={e => { setAccountSeqState(e.target.value); setTossAccountSeq(e.target.value); }}
                  className="border rounded px-1.5 py-0.5 text-[11px] bg-white">
            {accounts.map(a => <option key={a.accountSeq} value={String(a.accountSeq)}>{maskAccountNo(a.accountNo)} · {a.accountType}</option>)}
          </select>
        </div>
      )}

      {/* 연동 그룹 — 연결된 뒤에만 */}
      {configured && accountSeq && (
        <div className="rounded border border-violet-200 bg-white/70 p-2 text-[11px] space-y-1">
          {link ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-800">연동 그룹</span>
                <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 font-bold">🔗 {link.group}</span>
                <span className="text-gray-500">토스 기준 {fmtAt(link.meta.lastSyncAt)}{enabled ? " · 5분마다 자동" : " · 연동 꺼짐"}</span>
                <button onClick={() => void runSync()} disabled={busy || !enabled}
                        className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">{busy ? "갱신 중…" : "지금 갱신"}</button>
                <button onClick={() => void unlink()} disabled={busy}
                        className="px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">연동 그룹 해제</button>
              </div>
              {link.meta.lastError && <div className="text-rose-700">⚠️ 마지막 갱신 실패: {link.meta.lastError}</div>}
              <div className="text-[10px] text-gray-500">토스에서 가져온 종목(🔗)은 수정·삭제가 막히고, 같은 그룹에 손으로 넣은 종목은 지금처럼 관리됩니다. 예수금은 토스 주문 가능 금액입니다.</div>
            </>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-800">연동 그룹</span>
              <input type="text" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={DEFAULT_TOSS_GROUP}
                     className="border rounded px-2 py-0.5 text-[11px] w-40 focus:outline-none focus:border-violet-500" />
              <button onClick={() => void startLink()} disabled={busy}
                      className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">연동 시작</button>
              <span className="text-[10px] text-gray-500">이 이름의 그룹에 토스 보유가 들어옵니다(없으면 새로 만듦)</span>
            </div>
          )}
          {syncMsg && <div className={syncMsg.ok ? "text-emerald-700" : "text-rose-700"}>{syncMsg.ok ? "✅ " : "⚠️ "}{syncMsg.text}</div>}
        </div>
      )}

      {/* 진단 — 연결된 뒤에만. 응답 JSON 을 그대로(설계·문제 확인용) */}
      {configured && accountSeq && (
        <div className="text-[11px]">
          <button onClick={() => setProbeOpen(v => !v)} className="text-gray-500 hover:text-gray-800 underline decoration-dotted">
            🔎 진단 — 응답 보기 {probeOpen ? "▲" : "▼"}
          </button>
          {probeOpen && (
            <div className="mt-1 space-y-1">
              <div className="flex flex-wrap gap-1">
                {PROBES.map(([label, path]) => (
                  <button key={path} onClick={() => void runProbe(label, path)} disabled={busy}
                          className="px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">{label}</button>
                ))}
              </div>
              {probe && (
                <pre className="max-h-[320px] overflow-auto rounded border border-gray-200 bg-white p-2 text-[10px] leading-tight whitespace-pre-wrap break-all select-text">
                  <b>{probe.label}</b>{"\n"}{probe.text}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      <ul className="text-[10px] text-gray-500 leading-snug list-disc pl-4 space-y-0.5">
        <li><b>이 앱 전용 키</b>를 따로 발급하세요 — 토스는 키 하나에 토큰 하나만 살아 있어, 같은 키를 다른 프로그램과 나눠 쓰면 서로 끊깁니다. PC 한 대에서만 쓰세요.</li>
        <li>집·회사·VPN 이 바뀌어 공인 IP 가 달라지면 403 이 납니다 — 토스에서 허용 IP 를 다시 등록하세요.</li>
        <li>안 쓸 땐 토스 쪽에서 키를 끄거나 폐기하는 게 가장 안전합니다. 연결 해제는 이 PC 의 저장분만 지웁니다.</li>
      </ul>
    </div>
  );
}
