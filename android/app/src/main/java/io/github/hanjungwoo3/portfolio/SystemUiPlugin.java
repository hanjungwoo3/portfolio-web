package io.github.hanjungwoo3.portfolio;

import android.graphics.Color;
import android.view.View;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 앱 창 바탕색 — 위아래 시스템 막대 뒤·카메라 구멍(컷아웃) 띠는 웹 화면이 아니라 이 바탕이 보인다.
 * 야간에 그 자리가 흰색이라 너무 밝았다(사용자 지적 2026-10-25) → 웹이 야간/주간에 맞춰 색을 넘긴다.
 * 막대 아이콘 색(밝게/어둡게)은 Capacitor 내장 SystemBars.setStyle 이 맡는다.
 */
@CapacitorPlugin(name = "SystemUi")
public class SystemUiPlugin extends Plugin {
    @PluginMethod
    public void setBackground(PluginCall call) {
        String hex = call.getString("color", "#ffffff");
        final int color;
        try {
            color = Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            call.reject("bad color: " + hex);
            return;
        }
        getActivity().runOnUiThread(() -> {
            android.view.Window w = getActivity().getWindow();
            // 3버튼 내비게이션 막대 — 안드로이드가 자체 반투명 막(대비 보정)을 씌워 바탕이 비치지 않고 밝게 남았다 → 끄고 같은 색으로
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) w.setNavigationBarContrastEnforced(false);
            w.setNavigationBarColor(color);   // 안드로이드 15 미만에서 막대 자체 색(15+ 는 무시되고 아래 바탕이 비친다)
            w.getDecorView().setBackgroundColor(color);
            View parent = (View) getBridge().getWebView().getParent();   // 막대 여백(padding)을 가진 뷰
            if (parent != null) parent.setBackgroundColor(color);
            call.resolve();
        });
    }
}
