import type { Metadata } from "next";
import DownloadRedirectClient from "./DownloadRedirectClient";

export const metadata: Metadata = {
  title: "Download Wheel Deals",
  description: "Download Wheel Deals for iPhone or Android and discover promotional deals from local businesses.",
};

export default function DownloadPage() {
  return <DownloadRedirectClient />;
}
