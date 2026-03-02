import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Unique app identifier — reverse domain format (required for Play Store)
  appId: 'com.wheeldeals.app',

  // App name shown on the phone home screen
  appName: 'Wheel Deals',

  // Points to your live Vercel deployment.
  // All app content loads from here — so any Vercel deploy updates the app instantly
  // without needing to rebuild or resubmit to the Play Store.
  server: {
    url: 'https://wheel-deals-nine.vercel.app',
    cleartext: false, // HTTPS only — required for Play Store
  },

  // Android-specific settings
  android: {
    // Allow the WebView to use hardware acceleration
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // set to true during development if needed
  },

  // Web directory (not used in live-reload mode but required by Capacitor)
  webDir: 'out',

  plugins: {
    // Allow camera access for QR code scanning on the merchant redeem page
    Camera: {
      permissions: ['camera'],
    },
    // Allow geolocation for the "near me" discover feature
    Geolocation: {
      permissions: ['location'],
    },
  },
};

export default config;
