package io.github.hanjungwoo3.portfolio;

import android.app.PendingIntent;
import android.content.Intent;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

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
                        // 동의 화면을 띄우고 결과는 onConsent 로 받는다.
                        startActivityForResult(call, new Intent(), "onConsent");
                        try {
                            getActivity().startIntentSenderForResult(
                                    pi.getIntentSender(), 9001, null, 0, 0, 0);
                        } catch (Exception e) {
                            call.reject("consent-launch-failed: " + e.getMessage());
                        }
                        return;
                    }
                    resolveWithToken(call, result);
                })
                .addOnFailureListener(e -> call.reject("authorize-failed: " + e.getMessage()));
    }

    @ActivityCallback
    private void onConsent(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(getActivity())
                    .getAuthorizationResultFromIntent(activityResult.getData());
            resolveWithToken(call, result);
        } catch (Exception e) {
            call.reject("consent-result-failed: " + e.getMessage());
        }
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
