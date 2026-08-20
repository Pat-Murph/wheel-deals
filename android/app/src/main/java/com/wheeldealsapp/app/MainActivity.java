package com.wheeldealsapp.app;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.BridgeActivity;

/**
 * Keeps a Stripe return URL inside the app WebView.
 *
 * The app-link intent is delivered to this activity after checkout. Capacitor
 * forwards the lifecycle event to plugins by default, but it does not navigate
 * a live-server WebView to the full incoming URL. Loading it here preserves the
 * session_id and lets the web recovery flow verify the paid unlock.
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);

        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null || !"wheel-deals-nine.vercel.app".equals(data.getHost())) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;

        final String returnUrl = data.toString();
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(returnUrl));
    }
}
