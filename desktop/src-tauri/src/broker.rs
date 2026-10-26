// 증권사 공식 API 연결 — 1단계: 키 저장(OS 비밀 보관함) + 조회 전용 요청(토스증권 Open API).
//   계획서: docs/broker-api-integration-plan.md
//
//   왜 네이티브에서만 다루나 — 키(client_secret)로 실주문까지 되는데, 웹 코드가 키를 읽을 수 있으면
//   웹이 바뀌거나 뚫렸을 때 키가 샌다. 그래서 웹은 "토스에 이 경로를 조회해 줘"만 부탁하고,
//   키·토큰은 여기서만 꺼내 붙인다. **GET 만**, 호스트는 토스 Open API 하나로 고정.
//
//   저장: keyring 크레이트 — 맥 키체인 / 윈도우 자격 증명 관리자. Drive 동기화·파일 백업과는 무관한 자리.
//   토큰: 24시간, 클라이언트당 1개(새로 받으면 직전 토큰 무효 — 같은 키를 다른 프로그램과 나눠 쓰면 서로 끊는다)
//        → 받은 토큰을 보관함에 같이 저장해 앱을 다시 켜도 재사용한다. 만료 60초 전이나 401 이면 한 번 새로 받는다.
//   한도: ACCOUNT·ASSET·ORDER_HISTORY 묶음은 초당 1건 → 계좌성 경로는 1.1초 간격으로 줄 세운다.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SERVICE: &str = "io.github.hanjungwoo3.portfolio";

struct Broker {
    host: &'static str,
    token_url: &'static str,
}

fn broker_of(name: &str) -> Result<Broker, String> {
    match name {
        "toss" => Ok(Broker { host: "https://openapi.tossinvest.com", token_url: "https://openapi.tossinvest.com/oauth2/token" }),
        _ => Err(format!("모르는 증권사: {name}")),
    }
}

// ── 비밀 보관함 — 증권사당 **항목 하나**(JSON) + 프로세스 안 메모리 캐시 ──
//   왜 하나로 합쳤나(2026-10-26 사용자 제보 "암호가 맞아도 계속 뜬다"): 맥 키체인은 **항목마다** 접근 허용 창을 띄운다.
//   client_id·client_secret·token 세 항목이면 창이 세 번 뜨고, 토큰을 새로 쓰면 또 뜬다. 게다가 이 앱은 애플 개발자 서명이
//   없어(ad-hoc) 빌드마다 신원이 달라져 "항상 허용"이 다음 버전에서 무효가 된다.
//   → 항목 하나 + 처음 읽은 뒤엔 메모리만 쓰고(요청마다 보관함 안 건드림) + 읽는 데 성공하면 **지우고 다시 만든다**
//     (이 바이너리가 만든 항목은 이 바이너리에 허용돼 다음 실행부터 창이 안 뜬다). 결과: 앱 업데이트 뒤 **딱 한 번**만 묻는다.
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
struct Creds {
    client_id: String,
    client_secret: String,
    #[serde(default)]
    token: Option<String>, // "<exp>|<token>"
}

fn entry(broker: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("broker.{broker}")).map_err(|e| format!("비밀 보관함 열기 실패: {e}"))
}
fn legacy_entry(broker: &str, key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("broker.{broker}.{key}")).map_err(|e| format!("비밀 보관함 열기 실패: {e}"))
}
fn read_entry(e: &keyring::Entry) -> Result<Option<String>, String> {
    match e.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("비밀 보관함 읽기 실패: {e}")),
    }
}
fn delete_entry(e: &keyring::Entry) -> Result<(), String> {
    match e.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("비밀 보관함 삭제 실패: {e}")),
    }
}
// 보관함에 쓰기 — 지우고 새로 만든다(이 바이너리 소유 항목으로)
fn store_creds(broker: &str, c: &Creds) -> Result<(), String> {
    let e = entry(broker)?;
    let _ = delete_entry(&e);
    let json = serde_json::to_string(c).map_err(|e| format!("직렬화 실패: {e}"))?;
    e.set_password(&json).map_err(|e| format!("비밀 보관함 저장 실패: {e}"))
}
// 보관함에서 읽기(메모리에 없을 때 한 번) — 새 항목 → 없으면 옛 3항목(이전 버전) 이전 → 읽었으면 다시 만들어 소유권 갱신
fn load_creds(broker: &str) -> Result<Option<Creds>, String> {
    if let Some(raw) = read_entry(&entry(broker)?)? {
        if let Ok(c) = serde_json::from_str::<Creds>(&raw) {
            let _ = store_creds(broker, &c); // 소유권 갱신(실패해도 값은 있다)
            return Ok(Some(c));
        }
    }
    // 옛 형식(항목 3개) → 하나로 합치고 옛 것은 지운다
    let id = read_entry(&legacy_entry(broker, "client_id")?)?;
    let secret = read_entry(&legacy_entry(broker, "client_secret")?)?;
    if let (Some(client_id), Some(client_secret)) = (id, secret) {
        let token = read_entry(&legacy_entry(broker, "token")?).unwrap_or(None);
        let c = Creds { client_id, client_secret, token };
        store_creds(broker, &c)?;
        for k in ["client_id", "client_secret", "token"] {
            if let Ok(e) = legacy_entry(broker, k) { let _ = delete_entry(&e); }
        }
        return Ok(Some(c));
    }
    Ok(None)
}
// 메모리 캐시 우선 — 프로세스당 보관함은 한 번만 읽는다
fn creds_of(state: &BrokerState, broker: &str) -> Result<Option<Creds>, String> {
    if let Some(c) = state.creds.lock().map_err(|_| "lock")?.get(broker).cloned() {
        return Ok(Some(c));
    }
    let loaded = load_creds(broker)?;
    if let Some(c) = &loaded {
        state.creds.lock().map_err(|_| "lock")?.insert(broker.to_string(), c.clone());
    }
    Ok(loaded)
}
fn save_creds(state: &BrokerState, broker: &str, c: Creds) -> Result<(), String> {
    store_creds(broker, &c)?;
    state.creds.lock().map_err(|_| "lock")?.insert(broker.to_string(), c);
    Ok(())
}

#[derive(Default)]
pub struct BrokerState {
    // 키·토큰 메모리 캐시(보관함은 프로세스당 한 번)
    creds: Mutex<HashMap<String, Creds>>,
    // 토큰은 보관함에도 있지만 요청마다 읽지 않게 메모리에 — (access_token, 만료 epoch 초)
    tokens: Mutex<HashMap<String, (String, u64)>>,
    // 한도 — 묶음별 마지막 호출 시각
    last_call: Mutex<HashMap<String, Instant>>,
}

#[derive(serde::Serialize)]
pub struct BrokerStatus {
    configured: bool,
    client_id_hint: String, // 앞 4자리 — 어떤 키인지 알아볼 정도만, 비밀키는 절대 안 돌려준다
}

#[derive(serde::Serialize)]
pub struct BrokerRes {
    status: u16,
    body: String, // JSON 문자열 그대로(웹이 해석)
}

#[tauri::command]
pub fn broker_status(state: tauri::State<'_, BrokerState>, broker: String) -> Result<BrokerStatus, String> {
    broker_of(&broker)?;
    let c = creds_of(&state, &broker)?;
    let configured = c.as_ref().map(|c| !c.client_id.is_empty() && !c.client_secret.is_empty()).unwrap_or(false);
    Ok(BrokerStatus { configured, client_id_hint: c.map(|c| c.client_id.chars().take(4).collect()).unwrap_or_default() })
}

#[tauri::command]
pub fn broker_set(state: tauri::State<'_, BrokerState>, broker: String, client_id: String, client_secret: String) -> Result<(), String> {
    broker_of(&broker)?;
    let id = client_id.trim();
    let secret = client_secret.trim();
    if id.is_empty() || secret.is_empty() {
        return Err("client_id 와 client_secret 을 모두 넣어 주세요".into());
    }
    // 키가 바뀌었으니 옛 토큰은 버린다
    save_creds(&state, &broker, Creds { client_id: id.to_string(), client_secret: secret.to_string(), token: None })?;
    state.tokens.lock().map_err(|_| "lock")?.remove(&broker);
    Ok(())
}

#[tauri::command]
pub fn broker_clear(state: tauri::State<'_, BrokerState>, broker: String) -> Result<(), String> {
    broker_of(&broker)?;
    delete_entry(&entry(&broker)?)?;
    for k in ["client_id", "client_secret", "token"] {   // 이전 버전 항목도
        if let Ok(e) = legacy_entry(&broker, k) { let _ = delete_entry(&e); }
    }
    state.creds.lock().map_err(|_| "lock")?.remove(&broker);
    state.tokens.lock().map_err(|_| "lock")?.remove(&broker);
    Ok(())
}

fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// 유효한 토큰 — 메모리 → 보관함 → 새로 발급 순
async fn get_token(client: &reqwest::Client, state: &BrokerState, broker: &str, force_new: bool) -> Result<String, String> {
    let b = broker_of(broker)?;
    let creds = creds_of(state, broker)?.ok_or("증권사 키가 없습니다 — 설정에서 먼저 연결해 주세요")?;
    if !force_new {
        if let Some((t, exp)) = state.tokens.lock().map_err(|_| "lock")?.get(broker).cloned() {
            if exp > now_epoch() + 60 { return Ok(t); }
        }
        if let Some(raw) = creds.token.as_deref() {
            // "<exp>|<token>"
            if let Some((exp, t)) = raw.split_once('|') {
                if let Ok(exp) = exp.parse::<u64>() {
                    if exp > now_epoch() + 60 {
                        state.tokens.lock().map_err(|_| "lock")?.insert(broker.to_string(), (t.to_string(), exp));
                        return Ok(t.to_string());
                    }
                }
            }
        }
    }
    let id = creds.client_id.clone();
    let secret = creds.client_secret.clone();
    // 토스 실측(2026-09-09): 토큰 발급은 HTTP Basic — 폼 본문에 id/secret 을 넣으면 401
    let r = client
        .post(b.token_url)
        .basic_auth(&id, Some(&secret))
        .form(&[("grant_type", "client_credentials")])
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("토큰 발급 요청 실패: {e}"))?;
    let status = r.status().as_u16();
    let text = r.text().await.unwrap_or_default();
    if status != 200 {
        return Err(token_error_message(status, &text));
    }
    #[derive(serde::Deserialize)]
    struct Tok { access_token: String, #[serde(default)] expires_in: Option<u64> }
    let tok: Tok = serde_json::from_str(&text).map_err(|_| format!("토큰 응답을 읽지 못했습니다: {}", text.chars().take(200).collect::<String>()))?;
    let exp = now_epoch() + tok.expires_in.unwrap_or(86_400);
    // 토큰도 같은 항목에 — 앱을 다시 켜도 24시간 안이면 재사용(다른 프로그램과 키를 나눠 쓰면 서로 끊기므로)
    let _ = save_creds(state, broker, Creds { token: Some(format!("{exp}|{}", tok.access_token)), ..creds });
    state.tokens.lock().map_err(|_| "lock")?.insert(broker.to_string(), (tok.access_token.clone(), exp));
    Ok(tok.access_token)
}

// 사용자에게 보여 줄 말로 — 토스 토큰 오류는 거의 셋 중 하나(FAQ)
fn token_error_message(status: u16, body: &str) -> String {
    let b = body.to_lowercase();
    if status == 403 || b.contains("edge-blocked") {
        return "토스가 요청을 막았습니다(403) — 이 PC 의 공인 IP 가 토스 Open API 허용 IP 에 등록돼 있는지 확인해 주세요(집·회사·VPN 이 바뀌면 다시 등록)".into();
    }
    if status == 401 || b.contains("invalid_client") {
        return "키가 맞지 않습니다(invalid_client) — WTS 설정 > Open API 의 복사 버튼으로 client_id·client_secret 을 다시 붙여 넣어 주세요".into();
    }
    format!("토큰 발급 실패 ({status}): {}", body.chars().take(200).collect::<String>())
}

// 계좌성 경로(초당 1건 묶음)인가 — 1.1초 간격, 나머지는 0.08초
fn rate_group(path: &str) -> (&'static str, Duration) {
    const SLOW: [&str; 7] = ["/api/v1/accounts", "/api/v1/holdings", "/api/v1/orders", "/api/v1/conditional-orders", "/api/v1/buying-power", "/api/v1/sellable-quantity", "/api/v1/commissions"];
    if SLOW.iter().any(|p| path.starts_with(p)) { ("account", Duration::from_millis(1100)) } else { ("market", Duration::from_millis(80)) }
}

async fn wait_turn(state: &BrokerState, group: &str, gap: Duration) {
    // 락을 잡은 채 기다리지 않는다 — 다음 차례 시각만 예약하고 풀어 준 뒤 잔다
    let sleep_for = {
        let mut m = match state.last_call.lock() { Ok(m) => m, Err(_) => return };
        let now = Instant::now();
        let next = m.get(group).map(|t| *t + gap).filter(|t| *t > now).unwrap_or(now);
        m.insert(group.to_string(), next);
        next.saturating_duration_since(now)
    };
    if !sleep_for.is_zero() { tokio::time::sleep(sleep_for).await; }
}

/// 조회 전용 요청. path = "/api/v1/..."(쿼리 포함 가능). account = X-Tossinvest-Account(accountSeq).
///   GET 만 보낸다 — 주문·정정·취소는 전부 POST/DELETE 라 이 명령으로는 애초에 못 한다.
#[tauri::command]
pub async fn broker_fetch(
    client: tauri::State<'_, reqwest::Client>,
    state: tauri::State<'_, BrokerState>,
    broker: String,
    path: String,
    account: Option<String>,
) -> Result<BrokerRes, String> {
    let b = broker_of(&broker)?;
    if !path.starts_with("/api/v1/") || path.contains("..") || path.contains("://") {
        return Err(format!("허용되지 않는 경로: {path}"));
    }
    let url = format!("{}{}", b.host, path);
    let (group, gap) = rate_group(&path);

    let mut token = get_token(&client, &state, &broker, false).await?;
    for attempt in 0..2 {
        wait_turn(&state, group, gap).await;
        let mut req = client.get(&url).bearer_auth(&token).timeout(Duration::from_secs(20));
        if let Some(acc) = account.as_deref().filter(|s| !s.is_empty()) {
            req = req.header("X-Tossinvest-Account", acc);
        }
        let r = req.send().await.map_err(|e| format!("요청 실패: {e}"))?;
        let status = r.status().as_u16();
        let body = r.text().await.unwrap_or_default();
        if status >= 400 {
            // 원인 추적용 — 키·토큰은 안 찍는다(경로·상태·본문 앞부분만)
            eprintln!("broker_fetch {status} {path} {}", body.chars().take(200).collect::<String>());
        }
        // 토큰이 무효(다른 곳에서 새로 받아 끊겼거나 만료) → 한 번만 새로 받아 재시도
        if status == 401 && attempt == 0 {
            token = get_token(&client, &state, &broker, true).await?;
            continue;
        }
        return Ok(BrokerRes { status, body });
    }
    Err("요청 재시도 실패".into())
}

// 응답 본문을 웹에 그대로 넘기므로 base64 는 안 쓰지만, 바이너리가 섞인 경우를 대비해 남겨 둔다
#[allow(dead_code)]
fn b64(bytes: &[u8]) -> String { STANDARD.encode(bytes) }
