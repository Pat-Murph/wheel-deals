package com.wheeldealsapp.app;

import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Handles app-link payment returns and provides reliable Android-native
 * sharing and saving for branded Wheel Deals Beast images.
 */
public class MainActivity extends BridgeActivity {
    private final ExecutorService shareExecutor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new WheelDealsShareBridge(), "WheelDealsNative");
        }
    }

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

    @Override
    public void onDestroy() {
        shareExecutor.shutdownNow();
        super.onDestroy();
    }

    private boolean isApprovedShareUrl(String imageUrl) {
        if (imageUrl == null || imageUrl.isEmpty()) return false;
        Uri uri = Uri.parse(imageUrl);
        return "https".equalsIgnoreCase(uri.getScheme())
                && "wheel-deals-nine.vercel.app".equalsIgnoreCase(uri.getHost())
                && "/api/share/beast".equals(uri.getPath());
    }

    private HttpURLConnection openImageConnection(String imageUrl) throws Exception {
        URL url = new URL(imageUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "image/png");
        int responseCode = connection.getResponseCode();
        if (responseCode < 200 || responseCode >= 300) {
            connection.disconnect();
            throw new IllegalStateException("Share image request failed: " + responseCode);
        }
        return connection;
    }

    private void copyImage(HttpURLConnection connection, OutputStream output) throws Exception {
        try (InputStream input = connection.getInputStream(); OutputStream target = output) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                target.write(buffer, 0, count);
            }
            target.flush();
        } finally {
            connection.disconnect();
        }
    }

    private class WheelDealsShareBridge {
        @JavascriptInterface
        public void share(String title, String text, String imageUrl) {
            if (!isApprovedShareUrl(imageUrl)) {
                showToast("Unable to prepare this Wheel Deals image.", Toast.LENGTH_SHORT);
                return;
            }

            shareExecutor.execute(() -> {
                try {
                    File shareDir = new File(getCacheDir(), "wheel-deals-share");
                    if (!shareDir.exists() && !shareDir.mkdirs()) {
                        throw new IllegalStateException("Unable to create the share cache directory.");
                    }
                    File imageFile = new File(shareDir, "wheel-deals-beast-" + System.currentTimeMillis() + ".png");
                    copyImage(openImageConnection(imageUrl), new FileOutputStream(imageFile));

                    Uri contentUri = FileProvider.getUriForFile(
                            MainActivity.this,
                            getPackageName() + ".fileprovider",
                            imageFile
                    );

                    Intent shareIntent = new Intent(Intent.ACTION_SEND);
                    shareIntent.setType("image/png");
                    shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                    shareIntent.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                    shareIntent.putExtra(Intent.EXTRA_TITLE, title == null ? "Wheel Deals" : title);
                    shareIntent.setClipData(ClipData.newRawUri("Wheel Deals Beast", contentUri));
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                    runOnUiThread(() -> startActivity(Intent.createChooser(shareIntent, "Share your Wheel Deals Beast")));
                } catch (Exception error) {
                    showToast("Could not open sharing. Please try again.", Toast.LENGTH_LONG);
                }
            });
        }

        @JavascriptInterface
        public void save(String imageUrl) {
            if (!isApprovedShareUrl(imageUrl)) {
                showToast("Unable to prepare this Wheel Deals image.", Toast.LENGTH_SHORT);
                return;
            }

            shareExecutor.execute(() -> {
                Uri savedUri = null;
                try {
                    String filename = "wheel-deals-beast-" + System.currentTimeMillis() + ".png";
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
                        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Wheel Deals");
                        values.put(MediaStore.Images.Media.IS_PENDING, 1);
                        savedUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                        if (savedUri == null) throw new IllegalStateException("Unable to create the image in Photos.");

                        OutputStream output = getContentResolver().openOutputStream(savedUri);
                        if (output == null) throw new IllegalStateException("Unable to open the image destination.");
                        copyImage(openImageConnection(imageUrl), output);

                        ContentValues complete = new ContentValues();
                        complete.put(MediaStore.Images.Media.IS_PENDING, 0);
                        getContentResolver().update(savedUri, complete, null, null);
                    } else {
                        File picturesDir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Wheel Deals");
                        if (!picturesDir.exists() && !picturesDir.mkdirs()) {
                            throw new IllegalStateException("Unable to create the Wheel Deals image folder.");
                        }
                        File imageFile = new File(picturesDir, filename);
                        copyImage(openImageConnection(imageUrl), new FileOutputStream(imageFile));
                    }
                    showToast("Branded Beast image saved to Photos.", Toast.LENGTH_LONG);
                } catch (Exception error) {
                    if (savedUri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        getContentResolver().delete(savedUri, null, null);
                    }
                    showToast("Could not save the image. Please try again.", Toast.LENGTH_LONG);
                }
            });
        }

        private void showToast(String message, int duration) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, duration).show());
        }
    }
}
