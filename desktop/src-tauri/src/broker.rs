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

fn entry(broker: &str, key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("broker.{broker}.{key}")).map_err(|e| format!("비밀 보관함 열기 실패: {e}"))
}
fn kv_get(broker: &str, key: &str) -> Result<Option<String>, String> {
    match entry(broker, key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("비밀 보관함 읽기 실패: {e}")),
    }
}
fn kv_set(broker: &str, key: &str, val: &str) -> Result<(), String> {
    entry(broker, key)?.set_password(val).map_err(|e| format!("비밀 보관함 저장 실패: {e}"))
}
fn kv_del(broker: &str, key: &str) -> Result<(), String> {
    match entry(broker, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("비밀 보관함 삭제 실패: {e}")),
    }
}

#[derive(Default)]
pub struct BrokerState {
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
pub fn broker_status(broker: String) -> Result<BrokerStatus, String> {
    broker_of(&broker)?;
    let id = kv_get(&broker, "client_id")?;
    let secret = kv_get(&broker, "client_secret")?;
    let configured = id.is_some() && secret.is_some();
    Ok(BrokerStatus { configured, client_id_hint: id.map(|s| s.chars().take(4).collect()).unwrap_or_default() })
}

#[tauri::command]
pub fn broker_set(state: tauri::State<'_, BrokerState>, broker: String, client_id: String, client_secret: String) -> Result<(), String> {
    broker_of(&broker)?;
    let id = client_id.trim();
    let secret = client_secret.trim();
    if id.is_empty() || secret.is_empty() {
        return Err("client_id 와 client_secret 을 모두 넣어 주세요".into());
    }
    kv_set(&broker, "client_id", id)?;
    kv_set(&broker, "client_secret", secret)?;
    // 키가 바뀌었으니 옛 토큰은 버린다
    let _ = kv_del(&broker, "token");
    state.tokens.lock().map_err(|_| "lock")?.remove(&broker);
    Ok(())
}

#[tauri::command]
pub fn broker_clear(state: tauri::State<'_, BrokerState>, broker: String) -> Result<(), String> {
    broker_of(&broker)?;
    kv_del(&broker, "client_id")?;
    kv_del(&broker, "client_secret")?;
    kv_del(&broker, "token")?;
    state.tokens.lock().map_err(|_| "lock")?.remove(&broker);
    Ok(())
}

fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// 유효한 토큰 — 메모리 → 보관함 → 새로 발급 순
async fn get_token(client: &reqwest::Client, state: &BrokerState, broker: &str, force_new: bool) -> Result<String, String> {
    let b = broker_of(broker)?;
    if !force_new {
        if let Some((t, exp)) = state.tokens.lock().map_err(|_| "lock")?.get(broker).cloned() {
            if exp > now_epoch() + 60 { return Ok(t); }
        }
        if let Some(raw) = kv_get(broker, "token")? {
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
    let id = kv_get(broker, "client_id")?.ok_or("증권사 키가 없습니다 — 설정에서 먼저 연결해 주세요")?;
    let secret = kv_get(broker, "client_secret")?.ok_or("증권사 키가 없습니다 — 설정에서 먼저 연결해 주세요")?;
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
    let _ = kv_set(broker, "token", &format!("{exp}|{}", tok.access_token));
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
