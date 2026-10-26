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

// 증권사별 차이 — 토스: Basic 토큰·경로 /api/v1/·계좌 헤더 X-Tossinvest-Account.
//   한국투자(KIS Developers): JSON 토큰(POST /oauth2/tokenP, **1분에 1번만 발급** EGW00133 → 저장해 24h 재사용), 경로 /uapi/,
//   헤더 appkey·appsecret·tr_id(API 마다 다름, 모의는 V 로 시작)·custtype P·tr_cont(이어받기), 실전/모의 호스트가 다르다(mode).
//   한도(공식 FAQ): 실전 초당 20건, 모의 초당 2건. 허용 IP 등록은 없다.
struct Broker {
    host: &'static str,
    token_url: &'static str,
    path_prefix: &'static str,
}

fn broker_of(name: &str) -> Result<Broker, String> { broker_of_mode(name, None) }
fn broker_of_mode(name: &str, mode: Option<&str>) -> Result<Broker, String> {
    match name {
        "toss" => Ok(Broker { host: "https://openapi.tossinvest.com", token_url: "https://openapi.tossinvest.com/oauth2/token", path_prefix: "/api/v1/" }),
        "kis" => Ok(if mode == Some("paper") {
            Broker { host: "https://openapivts.koreainvestment.com:29443", token_url: "https://openapivts.koreainvestment.com:29443/oauth2/tokenP", path_prefix: "/uapi/" }
        } else {
            Broker { host: "https://openapi.koreainvestment.com:9443", token_url: "https://openapi.koreainvestment.com:9443/oauth2/tokenP", path_prefix: "/uapi/" }
        }),
        _ => Err(format!("모르는 증권사: {name}")),
    }
}

// ── 비밀 보관함 — **모든 증권사 키를 항목 하나**(JSON map) + 프로세스 안 메모리 캐시 ──
//   맥 키체인은 **항목마다**, 그리고 **비밀을 읽는 호출마다** 접근 허용 창을 띄운다. 이 앱은 애플 개발자 서명이 없어(ad-hoc)
//   빌드마다 신원이 달라져 "항상 허용"이 다음 버전에서 무효가 된다. 그래서 (2026-10-26~27 사용자 제보 "4번 뜬다" 실측):
//   · 항목은 전부 합쳐 하나(brokers) → 업데이트 뒤 읽기 1번.
//   · 처음 읽은 뒤엔 메모리만 쓴다(요청마다 보관함 안 건드림).
//   · 읽은 뒤 **지우고 다시 만들어** 이 바이너리 소유로(다음 실행부터 창 없음). 지울 때는 **비밀을 읽지 않고 참조만 찾아** 지운다 —
//     keyring 의 delete 는 find_generic_password 로 비밀을 꺼낸 뒤 지워서 창이 한 번 더 떴다(증권사당 2번 → 둘이면 4번).
//     SecItemDelete 는 다른 바이너리가 만든 항목에 -25244 를 내지만, kSecReturnRef 로 찾아 SecKeychainItemDelete 는 창 없이 된다(실측).
//   결과: 앱 업데이트 뒤 **딱 한 번**(증권사 수와 무관).
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
struct Creds {
    client_id: String,
    client_secret: String,
    #[serde(default)]
    token: Option<String>, // "<exp>|<token>"
    #[serde(default)]
    mode: Option<String>,  // 한국투자: "real" | "paper"(모의투자) — 호스트·tr_id 가 갈린다
}
type CredsMap = HashMap<String, Creds>;
const ITEM_ALL: &str = "brokers";   // 합친 항목(0.1.9~)

fn entry_named(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|e| format!("비밀 보관함 열기 실패: {e}"))
}
fn read_entry(e: &keyring::Entry) -> Result<Option<String>, String> {
    match e.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("비밀 보관함 읽기 실패: {e}")),
    }
}
// 비밀을 읽지 않고 지우기 — 맥은 참조만 찾아 지운다(허용 창 없음). 없으면 성공.
#[cfg(target_os = "macos")]
fn delete_noread(account: &str) -> Result<(), String> {
    use security_framework::item::{ItemClass, ItemSearchOptions, Reference, SearchResult};
    let found = ItemSearchOptions::new()
        .class(ItemClass::generic_password()).service(SERVICE).account(account)
        .load_refs(true).limit(16).search();
    match found {
        Ok(items) => {
            for it in items {
                if let SearchResult::Ref(Reference::KeychainItem(item)) = it { item.delete(); }
            }
            Ok(())
        }
        Err(e) if e.code() == -25300 => Ok(()),   // errSecItemNotFound
        Err(e) => Err(format!("비밀 보관함 삭제 실패: {e}")),
    }
}
#[cfg(not(target_os = "macos"))]
fn delete_noread(account: &str) -> Result<(), String> {
    match entry_named(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("비밀 보관함 삭제 실패: {e}")),
    }
}
// 합친 항목 쓰기 — 지우고(읽지 않고) 새로 만든다(이 바이너리 소유 항목으로). 비면 항목을 없앤다.
fn store_all(map: &CredsMap) -> Result<(), String> {
    delete_noread(ITEM_ALL)?;
    if map.is_empty() { return Ok(()); }
    let json = serde_json::to_string(map).map_err(|e| format!("직렬화 실패: {e}"))?;
    entry_named(ITEM_ALL)?.set_password(&json).map_err(|e| format!("비밀 보관함 저장 실패: {e}"))
}
// 이전 형식 — 증권사별 항목(0.1.6~0.1.8, JSON) → 더 옛 3항목(0.1.5). 있으면 한 번 읽는다(그 한 번은 창이 뜬다).
fn load_legacy(broker: &str) -> Result<Option<Creds>, String> {
    if let Some(raw) = read_entry(&entry_named(&format!("broker.{broker}"))?)? {
        if let Ok(c) = serde_json::from_str::<Creds>(&raw) { return Ok(Some(c)); }
    }
    let id = read_entry(&entry_named(&format!("broker.{broker}.client_id"))?)?;
    let secret = read_entry(&entry_named(&format!("broker.{broker}.client_secret"))?)?;
    if let (Some(client_id), Some(client_secret)) = (id, secret) {
        let token = read_entry(&entry_named(&format!("broker.{broker}.token"))?).unwrap_or(None);
        return Ok(Some(Creds { client_id, client_secret, token, mode: None }));
    }
    Ok(None)
}
fn delete_legacy_items(broker: &str) {
    let _ = delete_noread(&format!("broker.{broker}"));
    for k in ["client_id", "client_secret", "token"] { let _ = delete_noread(&format!("broker.{broker}.{k}")); }
}
const BROKERS: [&str; 2] = ["toss", "kis"];
// 보관함에서 읽기(프로세스당 한 번) — 합친 항목 → 없으면 이전 형식을 모아 합치고 옛 항목은 지운다
fn load_all() -> Result<CredsMap, String> {
    if let Some(raw) = read_entry(&entry_named(ITEM_ALL)?)? {
        let map: CredsMap = serde_json::from_str(&raw).unwrap_or_default();
        let _ = store_all(&map);   // 소유권 갱신(실패해도 값은 있다)
        return Ok(map);
    }
    let mut map = CredsMap::new();
    for b in BROKERS {
        if let Some(c) = load_legacy(b)? { map.insert(b.to_string(), c); }
    }
    if !map.is_empty() { store_all(&map)?; }
    for b in BROKERS { delete_legacy_items(b); }
    Ok(map)
}
// 메모리 캐시 — 잠금을 **쥔 채** 읽는다: 앱이 켜질 때 잔고·거래·일봉·중계가 동시에 키를 찾는데, 잠금을 풀고 읽으면
//   캐시가 비어 있는 사이 호출마다 보관함을 따로 읽어 창이 호출 수만큼 떴다. 첫 호출만 읽고 나머지는 기다렸다가 캐시를 본다.
fn with_creds<T>(state: &BrokerState, f: impl FnOnce(&mut CredsMap) -> T) -> Result<T, String> {
    let mut g = state.creds.lock().map_err(|_| "lock")?;
    if g.is_none() { *g = Some(load_all()?); }
    Ok(f(g.as_mut().expect("loaded")))
}
fn creds_of(state: &BrokerState, broker: &str) -> Result<Option<Creds>, String> {
    with_creds(state, |m| m.get(broker).cloned())
}
fn save_creds(state: &BrokerState, broker: &str, c: Creds) -> Result<(), String> {
    with_creds(state, |m| { m.insert(broker.to_string(), c); store_all(m) })?
}
fn remove_creds(state: &BrokerState, broker: &str) -> Result<(), String> {
    with_creds(state, |m| { m.remove(broker); store_all(m) })?
}

#[derive(Default)]
pub struct BrokerState {
    // 키·토큰 메모리 캐시(보관함은 프로세스당 한 번) — None = 아직 안 읽음
    creds: Mutex<Option<CredsMap>>,
    // 토큰은 보관함에도 있지만 요청마다 읽지 않게 메모리에 — (access_token, 만료 epoch 초)
    tokens: Mutex<HashMap<String, (String, u64)>>,
    // 한도 — 묶음별 마지막 호출 시각
    last_call: Mutex<HashMap<String, Instant>>,
}

#[derive(serde::Serialize)]
pub struct BrokerStatus {
    configured: bool,
    client_id_hint: String, // 앞 4자리 — 어떤 키인지 알아볼 정도만, 비밀키는 절대 안 돌려준다
    mode: Option<String>,   // 한국투자 real/paper
}

#[derive(serde::Serialize)]
pub struct BrokerRes {
    status: u16,
    body: String, // JSON 문자열 그대로(웹이 해석)
    #[serde(default)]
    tr_cont: Option<String>, // 한국투자 응답 헤더 — "F"/"M" 이면 다음 페이지 있음(웹이 이어받기)
}

#[tauri::command]
// async — 보관함 접근(맥 허용 창 포함)이 메인 스레드를 막지 않게. 동기 명령은 메인 스레드에서 돌아 허용 창이 떠 있는 동안
//   앱 전체(IPC·다른 요청)가 멈췄다(2026-10-26 개발 빌드 실측: 요청 15건 뒤 정지).
pub async fn broker_status(state: tauri::State<'_, BrokerState>, broker: String) -> Result<BrokerStatus, String> {
    broker_of(&broker)?;
    let c = creds_of(&state, &broker)?;
    let configured = c.as_ref().map(|c| !c.client_id.is_empty() && !c.client_secret.is_empty()).unwrap_or(false);
    let mode = c.as_ref().and_then(|c| c.mode.clone());
    Ok(BrokerStatus { configured, client_id_hint: c.map(|c| c.client_id.chars().take(4).collect()).unwrap_or_default(), mode })
}

#[tauri::command]
// async — 보관함 접근(맥 허용 창 포함)이 메인 스레드를 막지 않게. 동기 명령은 메인 스레드에서 돌아 허용 창이 떠 있는 동안
//   앱 전체(IPC·다른 요청)가 멈췄다(2026-10-26 개발 빌드 실측: 요청 15건 뒤 정지).
pub async fn broker_set(state: tauri::State<'_, BrokerState>, broker: String, client_id: String, client_secret: String, mode: Option<String>) -> Result<(), String> {
    broker_of(&broker)?;
    let id = client_id.trim();
    let secret = client_secret.trim();
    if id.is_empty() || secret.is_empty() {
        return Err("client_id 와 client_secret 을 모두 넣어 주세요".into());
    }
    let mode = mode.filter(|m| m == "real" || m == "paper");
    // 키가 바뀌었으니 옛 토큰은 버린다
    save_creds(&state, &broker, Creds { client_id: id.to_string(), client_secret: secret.to_string(), token: None, mode })?;
    state.tokens.lock().map_err(|_| "lock")?.remove(&broker);
    Ok(())
}

#[tauri::command]
// async — 보관함 접근(맥 허용 창 포함)이 메인 스레드를 막지 않게. 동기 명령은 메인 스레드에서 돌아 허용 창이 떠 있는 동안
//   앱 전체(IPC·다른 요청)가 멈췄다(2026-10-26 개발 빌드 실측: 요청 15건 뒤 정지).
pub async fn broker_clear(state: tauri::State<'_, BrokerState>, broker: String) -> Result<(), String> {
    broker_of(&broker)?;
    remove_creds(&state, &broker)?;
    delete_legacy_items(&broker);   // 이전 버전 항목도(읽지 않고)
    state.tokens.lock().map_err(|_| "lock")?.remove(&broker);
    Ok(())
}

fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// 유효한 토큰 — 메모리 → 보관함 → 새로 발급 순
async fn get_token(client: &reqwest::Client, state: &BrokerState, broker: &str, force_new: bool) -> Result<String, String> {
    let creds = creds_of(state, broker)?.ok_or("증권사 키가 없습니다 — 설정에서 먼저 연결해 주세요")?;
    let b = broker_of_mode(broker, creds.mode.as_deref())?;
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
    let r = if broker == "kis" {
        // 한국투자: JSON 본문. 1분에 1번만 발급되므로(EGW00133) 아래에서 저장해 재사용한다
        client
            .post(b.token_url)
            .header("content-type", "application/json; charset=utf-8")
            .body(serde_json::json!({ "grant_type": "client_credentials", "appkey": id, "appsecret": secret }).to_string())
            .timeout(Duration::from_secs(15))
            .send()
            .await
    } else {
        // 토스 실측(2026-09-09): 토큰 발급은 HTTP Basic — 폼 본문에 id/secret 을 넣으면 401
        client
            .post(b.token_url)
            .basic_auth(&id, Some(&secret))
            .form(&[("grant_type", "client_credentials")])
            .timeout(Duration::from_secs(15))
            .send()
            .await
    }
    .map_err(|e| format!("토큰 발급 요청 실패: {e}"))?;
    let status = r.status().as_u16();
    let text = r.text().await.unwrap_or_default();
    if status != 200 {
        return Err(if broker == "kis" { kis_token_error_message(status, &text) } else { token_error_message(status, &text) });
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

// 한국투자 토큰 오류 — 1분 제한·키 불일치가 대부분
fn kis_token_error_message(status: u16, body: &str) -> String {
    if body.contains("EGW00133") {
        return "한국투자 토큰은 1분에 한 번만 발급됩니다 — 1분 뒤 다시 시도해 주세요(앱은 받은 토큰을 24시간 재사용합니다)".into();
    }
    if status == 401 || status == 403 || body.contains("EGW00002") || body.contains("EGW00001") {
        return "앱키·앱시크릿이 맞지 않습니다 — KIS Developers 에서 다시 복사해 주세요(실전/모의 키가 다릅니다)".into();
    }
    format!("한국투자 토큰 발급 실패 ({status}): {}", body.chars().take(200).collect::<String>())
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

// 계좌성 경로(초당 1건 묶음)인가 — 1.1초 간격, 나머지는 0.08초. 한국투자는 실전 20/s(60ms)·모의 2/s(550ms)
fn rate_group(broker: &str, mode: Option<&str>, path: &str) -> (&'static str, Duration) {
    if broker == "kis" {
        return if mode == Some("paper") { ("kis-paper", Duration::from_millis(550)) } else { ("kis", Duration::from_millis(60)) };
    }
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

/// 조회 전용 요청. path = "/api/v1/..."(토스) 또는 "/uapi/..."(한국투자), 쿼리 포함 가능.
///   account = 토스 X-Tossinvest-Account(accountSeq). tr_id/tr_cont = 한국투자 헤더(그 둘만 받는다).
///   GET 만 보낸다 — 주문·정정·취소는 전부 POST/DELETE 라 이 명령으로는 애초에 못 한다.
#[tauri::command]
pub async fn broker_fetch(
    client: tauri::State<'_, reqwest::Client>,
    state: tauri::State<'_, BrokerState>,
    broker: String,
    path: String,
    account: Option<String>,
    tr_id: Option<String>,
    tr_cont: Option<String>,
) -> Result<BrokerRes, String> {
    let mode = creds_of(&state, &broker)?.and_then(|c| c.mode);
    let b = broker_of_mode(&broker, mode.as_deref())?;
    if !path.starts_with(b.path_prefix) || path.contains("..") || path.contains("://") {
        return Err(format!("허용되지 않는 경로: {path}"));
    }
    let url = format!("{}{}", b.host, path);
    let (group, gap) = rate_group(&broker, mode.as_deref(), &path);

    let mut token = get_token(&client, &state, &broker, false).await?;
    for attempt in 0..2 {
        wait_turn(&state, group, gap).await;
        let mut req = client.get(&url).bearer_auth(&token).timeout(Duration::from_secs(20));
        if broker == "kis" {
            // 한국투자는 키를 헤더로도 요구한다(토큰과 별개). tr_id 는 API 마다 다르고 모의는 V 로 시작(웹이 맞춰 보낸다)
            let c = creds_of(&state, &broker)?.ok_or("증권사 키가 없습니다")?;
            req = req
                .header("content-type", "application/json; charset=utf-8")
                .header("appkey", c.client_id)
                .header("appsecret", c.client_secret)
                .header("custtype", "P")
                .header("tr_id", tr_id.clone().unwrap_or_default())
                .header("tr_cont", tr_cont.clone().unwrap_or_default());
        } else if let Some(acc) = account.as_deref().filter(|s| !s.is_empty()) {
            req = req.header("X-Tossinvest-Account", acc);
        }
        let r = req.send().await.map_err(|e| format!("요청 실패: {e}"))?;
        let status = r.status().as_u16();
        let res_tr_cont = r.headers().get("tr_cont").and_then(|v| v.to_str().ok()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let body = r.text().await.unwrap_or_default();
        if status >= 400 {
            // 원인 추적용 — 키·토큰은 안 찍는다(경로·상태·본문 앞부분만)
            eprintln!("broker_fetch {status} {path} {}", body.chars().take(200).collect::<String>());
        }
        // 토큰이 무효(다른 곳에서 새로 받아 끊겼거나 만료) → 한 번만 새로 받아 재시도
        // 한국투자는 토큰 만료를 HTTP 500 + EGW00123 으로 준다
        let kis_expired = broker == "kis" && (body.contains("EGW00123") || body.contains("EGW00121"));
        if (status == 401 || kis_expired) && attempt == 0 {
            token = get_token(&client, &state, &broker, true).await?;
            continue;
        }
        return Ok(BrokerRes { status, body, tr_cont: res_tr_cont });
    }
    Err("요청 재시도 실패".into())
}

// 응답 본문을 웹에 그대로 넘기므로 base64 는 안 쓰지만, 바이너리가 섞인 경우를 대비해 남겨 둔다
#[allow(dead_code)]
fn b64(bytes: &[u8]) -> String { STANDARD.encode(bytes) }
