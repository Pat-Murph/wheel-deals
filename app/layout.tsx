import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wheel Deals",
  description: "Unlock promotional deals at local merchants — discover and redeem exclusive offers near you.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/wheel-deals-logo.png", sizes: "192x192", type: "image/png" },
      { url: "/wheel-deals-logo.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/wheel-deals-logo.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Wheel Deals",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "google-site-verification": "j2HPC-GzTO_v0z-o1lCMI2iCBjLPLjrTRrE58w1bH68",
    "color-scheme": "light",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
