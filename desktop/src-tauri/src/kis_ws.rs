// 한국투자 실시간 체결(웹소켓) — 사용자 2026-11-02 "소켓도 진행".
//   종목정보 창 체결 칸이 토스 체결(5초마다 최근 300건)을 폴링하던 것을, 한국투자 연동이면 체결이 나는 즉시 받는다.
//
//   흐름: 웹이 1초마다 kis_ws_poll(codes) — "지금 이 종목들을 보고 있다" + 그 사이 쌓인 체결을 가져간다.
//     · 처음 부르면 접속키(approval_key)를 받아(POST /oauth2/Approval — **키 발급용 POST 하나만 예외**, 주문 경로는 여전히 못 부른다)
//       ws://ops.koreainvestment.com:21000(모의 31000) 에 붙고, H0STCNT0(국내주식 실시간 체결가, KRX) 를 종목마다 등록한다.
//     · 접속키는 웹에 절대 넘기지 않는다(앱키·시크릿과 같은 취급). 웹은 체결 문자열만 받는다.
//     · 30초 동안 poll 이 없으면(창을 닫음) 등록을 풀고 연결을 끊는다.
//   메시지: 데이터는 "0|H0STCNT0|003|필드^필드^…"(건수만큼 46필드씩 이어 붙음, 암호화 없음), 시스템 메시지는 JSON(구독 응답·PINGPONG).
//   한 세션 등록 상한 41건 → 20종목으로 자른다.
use crate::broker::BrokerState;
use futures_util::{SinkExt, StreamExt};
use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

// 실전 = H0UNCNT0(통합 KRX+NXT 체결 — NXT 프리 08:00·애프터 ~20:00 도, 사용자 2026-11-09 "한투 통합 체결도"), 모의 = H0STCNT0(KRX — 모의엔 통합이 없다)
const TR_ID_REAL: &str = "H0UNCNT0";
const TR_ID_PAPER: &str = "H0STCNT0";
// 호가 — 키가 'Q'+종목코드면 실시간 호가(실전 H0UNASP0 통합 · 모의 H0STASP0)(사용자 2026-11-09 "호가도 소켓으로")
const ASP_REAL: &str = "H0UNASP0";
const ASP_PAPER: &str = "H0STASP0";
// 거래원(회원사) — 키가 'M'+종목코드면 실시간 회원사(실전 H0UNMBC0 통합 · 모의 H0STMBC0)(사용자 2026-11-10 "거래원 정보도 한투 api — 바로 2번")
const MBC_REAL: &str = "H0UNMBC0";
const MBC_PAPER: &str = "H0STMBC0";
const MAX_CODES: usize = 20;
const MAX_BUF: usize = 5000;
const IDLE: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Shared {
    want: HashSet<String>,
    buf: VecDeque<String>,
    status: String,
    last_poll: Option<Instant>,
    running: bool,
}

#[derive(Default, Clone)]
pub struct KisWsState { inner: Arc<Mutex<Shared>> }

#[derive(serde::Serialize)]
pub struct WsPoll {
    status: String,      // "connecting" | "live" | "error: …"
    data: Vec<String>,   // 데이터 메시지 원문("0|H0STCNT0|건수|필드^…") — 웹이 나눈다
}

fn sub_msg(key: &str, code: &str, on: bool, paper: bool) -> String {
    serde_json::json!({
        "header": { "approval_key": key, "custtype": "P", "tr_type": if on { "1" } else { "2" }, "content-type": "utf-8" },
        "body": { "input": { "tr_id": match (code.chars().next(), paper) {
                                 (Some('Q'), true) => ASP_PAPER, (Some('Q'), false) => ASP_REAL,
                                 (Some('M'), true) => MBC_PAPER, (Some('M'), false) => MBC_REAL,
                                 (_, true) => TR_ID_PAPER, (_, false) => TR_ID_REAL },
                             "tr_key": code.trim_start_matches(['Q', 'M']) } }
    }).to_string()
}

#[tauri::command]
pub async fn kis_ws_poll(
    client: tauri::State<'_, reqwest::Client>,
    broker: tauri::State<'_, BrokerState>,
    ws: tauri::State<'_, KisWsState>,
    codes: Vec<String>,
) -> Result<WsPoll, String> {
    let codes: HashSet<String> = codes.into_iter()
        .filter(|c| { let k = c.strip_prefix('Q').or_else(|| c.strip_prefix('M')).unwrap_or(c); k.len() == 6 && k.chars().all(|ch| ch.is_ascii_alphanumeric()) })
        .take(MAX_CODES).collect();
    let start = {
        let mut s = ws.inner.lock().map_err(|_| "lock")?;
        s.want = codes;
        s.last_poll = Some(Instant::now());
        let start = !s.running && !s.want.is_empty();
        if start { s.running = true; s.status = "connecting".into(); }
        start
    };
    if start {
        match approval(&client, &broker).await {
            Ok((key, url)) => { let st = ws.inner.clone(); tauri::async_runtime::spawn(run(st, key, url)); }
            Err(e) => {
                let mut s = ws.inner.lock().map_err(|_| "lock")?;
                s.running = false;
                s.status = format!("error: {e}");
            }
        }
    }
    let mut s = ws.inner.lock().map_err(|_| "lock")?;
    let data: Vec<String> = s.buf.drain(..).collect();
    let status = s.status.clone();
    if status.starts_with("error") && !s.running { s.status.clear(); }   // 다음 poll 에서 다시 시도
    Ok(WsPoll { status, data })
}

// 접속키 — 앱키·시크릿으로 POST /oauth2/Approval. 웹소켓 주소도 실전/모의에 맞춰
async fn approval(client: &reqwest::Client, broker: &BrokerState) -> Result<(String, String), String> {
    let c = broker.kis_creds()?.ok_or("한국투자 키가 없습니다 — 설정에서 먼저 연결해 주세요")?;
    let paper = c.2.as_deref() == Some("paper");
    let host = if paper { "https://openapivts.koreainvestment.com:29443" } else { "https://openapi.koreainvestment.com:9443" };
    let r = client.post(format!("{host}/oauth2/Approval"))
        .header("content-type", "application/json; charset=utf-8")
        .body(serde_json::json!({ "grant_type": "client_credentials", "appkey": c.0, "secretkey": c.1 }).to_string())
        .timeout(Duration::from_secs(15))
        .send().await.map_err(|e| format!("접속키 요청 실패: {e}"))?;
    let status = r.status().as_u16();
    let text = r.text().await.unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let key = v.get("approval_key").and_then(|k| k.as_str()).unwrap_or("").to_string();
    if status != 200 || key.is_empty() {
        return Err(format!("접속키 발급 실패 ({status}): {}", text.chars().take(160).collect::<String>()));
    }
    let url = if paper { "ws://ops.koreainvestment.com:31000/tryitout" } else { "ws://ops.koreainvestment.com:21000/tryitout" };
    Ok((key, url.to_string()))
}

async fn run(st: Arc<Mutex<Shared>>, key: String, url: String) {
    let paper = url.contains(":31000");   // 모의 서버면 통합 체결이 없어 KRX(H0STCNT0)
    let set_status = |s: &str| { if let Ok(mut g) = st.lock() { g.status = s.to_string(); } };
    let mut fails = 0u32;
    'outer: loop {
        let conn = tokio::time::timeout(Duration::from_secs(10), tokio_tungstenite::connect_async(url.as_str())).await;
        let stream = match conn {
            Ok(Ok((s, _))) => s,
            other => {
                fails += 1;
                let msg = match other { Ok(Err(e)) => e.to_string(), _ => "시간 초과".into() };
                set_status(&format!("error: 웹소켓 연결 실패 — {msg}"));
                if fails >= 5 { break 'outer; }
                tokio::time::sleep(Duration::from_secs(3 * fails as u64)).await;
                continue;
            }
        };
        let (mut tx, mut rx) = stream.split();
        let mut subscribed: HashSet<String> = HashSet::new();
        let mut tick = tokio::time::interval(Duration::from_millis(500));
        set_status("live");
        loop {
            tokio::select! {
                m = rx.next() => match m {
                    Some(Ok(Message::Text(t))) => {
                        let t: String = t.to_string();
                        if t.starts_with('0') || t.starts_with('1') {
                            fails = 0;   // 데이터가 들어오면 정상 — 끊김 횟수 초기화
                            if let Ok(mut g) = st.lock() {
                                g.buf.push_back(t);
                                while g.buf.len() > MAX_BUF { g.buf.pop_front(); }
                            }
                        } else if t.contains("PINGPONG") {
                            let _ = tx.send(Message::Pong(t.into_bytes().into())).await;
                        } else if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                            // 구독 응답 — 실패(rt_cd≠0)면 사유를 상태로(예: 접속키 만료·한도 초과)
                            let rt = v.pointer("/body/rt_cd").and_then(|x| x.as_str()).unwrap_or("0");
                            if rt != "0" {
                                let msg = v.pointer("/body/msg1").and_then(|x| x.as_str()).unwrap_or("").to_string();
                                set_status(&format!("error: {msg}"));
                            }
                        }
                    }
                    Some(Ok(Message::Ping(p))) => { let _ = tx.send(Message::Pong(p)).await; }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                },
                _ = tick.tick() => {
                    let (want, idle) = match st.lock() {
                        Ok(g) => (g.want.clone(), g.last_poll.map(|t| t.elapsed() > IDLE).unwrap_or(true)),
                        Err(_) => break 'outer,
                    };
                    if idle || want.is_empty() {
                        for c in &subscribed { let _ = tx.send(Message::Text(sub_msg(&key, c, false, paper).into())).await; }
                        let _ = tx.send(Message::Close(None)).await;
                        break 'outer;
                    }
                    for c in subscribed.difference(&want).cloned().collect::<Vec<_>>() {
                        let _ = tx.send(Message::Text(sub_msg(&key, &c, false, paper).into())).await;
                        subscribed.remove(&c);
                    }
                    for c in want.difference(&subscribed).cloned().collect::<Vec<_>>() {
                        if tx.send(Message::Text(sub_msg(&key, &c, true, paper).into())).await.is_ok() { subscribed.insert(c); }
                    }
                }
            }
        }
        // 끊김 — 잠시 뒤 다시 붙는다(등록은 새 연결에서 다시)
        fails += 1;
        set_status("connecting");
        if fails >= 5 { set_status("error: 웹소켓이 계속 끊깁니다"); break; }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    if let Ok(mut g) = st.lock() {
        g.running = false;
        if g.status == "live" || g.status == "connecting" { g.status.clear(); }
    }
}
