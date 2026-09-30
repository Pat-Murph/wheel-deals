function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

// Defaults to paused. Set NEXT_PUBLIC_REFERRAL_PROGRAM_ENABLED=true in Vercel
// and redeploy to restore the referral banner, page, and onboarding field.
export const REFERRAL_PROGRAM_ENABLED = enabled(
  process.env.NEXT_PUBLIC_REFERRAL_PROGRAM_ENABLED
);
