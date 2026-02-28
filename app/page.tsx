import { redirect } from "next/navigation";

/**
 * Root page — redirects to /discover which is the main entry point.
 */
export default function Page() {
  redirect("/discover");
}
