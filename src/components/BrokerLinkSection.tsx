// 설정 → 증권사 연결(토스증권 Open API). PC 설정·모바일 설정이 같이 쓴다.
//   데스크톱 앱에서만 실제로 연결된다(키는 OS 비밀 보관함, 조회만). 웹·안드로이드는 안내만.
//   계획서: docs/broker-api-integration-plan.md — 1단계(키 저장·연결 시험)
import { useEffect, useState } from "react";
import {
  isBrokerAvailable, brokerStatus, brokerSet, brokerClear, fetchTossAccounts,
  getTossEnabled, setTossEnabled, getTossAccountSeq, setTossAccountSeq, maskAccountNo,
  BrokerError, type TossAccount,
} from "../lib/broker";
import { getIndependentGroupsMode } from "../lib/groupMode";
import { appConfirm } from "../lib/appDialog";

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

      <ul className="text-[10px] text-gray-500 leading-snug list-disc pl-4 space-y-0.5">
        <li><b>이 앱 전용 키</b>를 따로 발급하세요 — 토스는 키 하나에 토큰 하나만 살아 있어, 같은 키를 다른 프로그램과 나눠 쓰면 서로 끊깁니다. PC 한 대에서만 쓰세요.</li>
        <li>집·회사·VPN 이 바뀌어 공인 IP 가 달라지면 403 이 납니다 — 토스에서 허용 IP 를 다시 등록하세요.</li>
        <li>안 쓸 땐 토스 쪽에서 키를 끄거나 폐기하는 게 가장 안전합니다. 연결 해제는 이 PC 의 저장분만 지웁니다.</li>
      </ul>
    </div>
  );
}
