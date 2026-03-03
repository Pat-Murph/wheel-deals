import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/**
 * Root page — redirects to /discover which is the main entry point.
 */
export default function Page() {
  redirect("/discover");
}
