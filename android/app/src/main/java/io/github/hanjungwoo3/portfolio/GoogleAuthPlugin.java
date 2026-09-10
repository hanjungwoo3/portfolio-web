package io.github.hanjungwoo3.portfolio;

import android.app.PendingIntent;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;

import java.util.Collections;

/**
 * 구글 액세스 토큰을 안드로이드 네이티브로 받는다.
 *
 * 왜 필요한가 — 앱에서 브라우저 기반 OAuth 를 쓸 수 없다.
 *   · 구글은 임베디드 웹뷰의 OAuth 를 정책적으로 막는다(disallowed_useragent).
 *   · Custom Tab + 커스텀 스킴 리다이렉트는 구글이 안드로이드에서 폐기했다
 *     ("Custom URI schemes are no longer supported on Android" — 실측: invalid_request).
 *   → 남은 정식 경로는 플레이 서비스의 AuthorizationClient 뿐이다.
 *
 * 이게 1시간 로그아웃을 푸는 방식 — refresh token 을 안 쓴다.
 *   계정이 기기에 있으니, 한 번 동의한 뒤로는 authorize() 를 다시 부르면
 *   UI 없이 새 액세스 토큰이 나온다(hasResolution()==false 인 경로).
 *   구글 문서: "call the same method to obtain an access token ... without any user interaction"
 *
 * 필요한 콘솔 설정: 패키지명 + 릴리스 키 SHA-1 로 만든 Android 클라이언트.
 *   (클라이언트 ID 를 코드에 넣지 않는다 — 플레이 서비스가 패키지·서명으로 앱을 식별한다)
 */
@CapacitorPlugin(name = "GoogleAuth")
public class GoogleAuthPlugin extends Plugin {

    /**
     * 액세스 토큰 요청.
     *   interactive=false : 이미 동의돼 있으면 조용히 토큰, 아니면 needsConsent 로 알린다.
     *   interactive=true  : 필요하면 동의 화면을 띄운다.
     * 웹은 만료 5분 전에 interactive=false 로 부르고, 실패했을 때만 사용자 클릭으로 true 를 부른다.
     */
    @PluginMethod
    public void getAccessToken(PluginCall call) {
        String scope = call.getString("scope", "https://www.googleapis.com/auth/drive.appdata");
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));

        AuthorizationRequest request = AuthorizationRequest.builder()
                .setRequestedScopes(Collections.singletonList(new Scope(scope)))
                .build();

        Identity.getAuthorizationClient(getActivity())
                .authorize(request)
                .addOnSuccessListener(result -> {
                    if (result.hasResolution()) {
                        // 아직 동의 전 — 사용자 조작이 필요하다.
                        if (!interactive) {
                            JSObject ret = new JSObject();
                            ret.put("needsConsent", true);
                            call.resolve(ret);
                            return;
                        }
                        PendingIntent pi = result.getPendingIntent();
                        if (pi == null) {
                            call.reject("no-pending-intent");
                            return;
                        }
                        // ★ 동의 화면은 PendingIntent(IntentSender) 라 일반 Intent 로 못 띄운다.
                        //   Capacitor 의 startActivityForResult 에 빈 Intent 를 넘겼다가
                        //   ActivityNotFoundException 으로 앱이 죽었다(실측). IntentSenderRequest 로 감싼다.
                        pendingConsentCall = call;
                        bridge.saveCall(call);
                        try {
                            consentLauncher.launch(new IntentSenderRequest.Builder(
                                    pi.getIntentSender()).build());
                        } catch (Exception e) {
                            pendingConsentCall = null;
                            call.reject("consent-launch-failed: " + e.getMessage());
                        }
                        return;
                    }
                    resolveWithToken(call, result);
                })
                .addOnFailureListener(e -> call.reject("authorize-failed: " + e.getMessage()));
    }

    // 동의 화면 결과 수신기. load() 에서 한 번만 등록한다(액티비티 생성 뒤여야 한다).
    private ActivityResultLauncher<IntentSenderRequest> consentLauncher;
    private PluginCall pendingConsentCall;

    @Override
    public void load() {
        consentLauncher = getActivity().registerForActivityResult(
                new ActivityResultContracts.StartIntentSenderForResult(),
                activityResult -> {
                    PluginCall call = pendingConsentCall;
                    pendingConsentCall = null;
                    if (call == null) return;
                    try {
                        AuthorizationResult result = Identity.getAuthorizationClient(getActivity())
                                .getAuthorizationResultFromIntent(activityResult.getData());
                        resolveWithToken(call, result);
                    } catch (Exception e) {
                        call.reject("consent-result-failed: " + e.getMessage());
                    }
                });
    }

    /**
     * 캐시된 액세스 토큰 폐기.
     *
     * 왜 필요한가 — 로그아웃에서 구글 revoke 엔드포인트만 부르면 서버 쪽 권한은 사라지는데
     *   플레이 서비스는 그 토큰을 계속 캐시에서 돌려준다. 그러면 재로그인 때 동의 창 없이
     *   "로그인됨" 이 되고 실제 API 호출만 401 로 죽는다(실측). 캐시를 같이 비워야 한다.
     *   네트워크를 타므로 메인 스레드에서 부르면 안 된다.
     */
    @PluginMethod
    public void clearToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) { call.resolve(); return; }
        new Thread(() -> {
            try {
                GoogleAuthUtil.clearToken(getContext(), token);
            } catch (Exception ignored) {
                // 이미 무효한 토큰이면 예외가 난다 — 목적은 캐시 제거라 무시해도 된다.
            }
            call.resolve();
        }).start();
    }

    private void resolveWithToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null) {
            call.reject("no-access-token");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("accessToken", token);
        // 플레이 서비스는 만료 시각을 안 준다. 구글 액세스 토큰은 1시간 고정이라 그렇게 본다.
        //   조금 짧게 잡아 두면 만료 직전 갱신이 확실해진다.
        ret.put("expiresIn", 3600);
        call.resolve(ret);
    }
}
