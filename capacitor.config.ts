import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Unique app identifier — must match App Store Connect & Play Store bundle ID
  appId: 'com.wheeldealsapp.app',

  // App name shown on the phone home screen
  appName: 'Wheel Deals',

  // Points to your live Vercel deployment.
  // All app content loads from here — so any Vercel deploy updates the app instantly
  // without needing to rebuild or resubmit to the App Store / Play Store.
  server: {
    url: 'https://wheel-deals-nine.vercel.app',
    cleartext: false, // HTTPS only
  },

  // iOS-specific settings
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: true,
    scrollEnabled: true,
    scheme: 'Wheel Deals',
  },

  // Android-specific settings
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  // Web directory (not used in live-URL mode but required by Capacitor)
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
    // Status bar styling for iOS
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff',
    },
  },
};

export default config;
