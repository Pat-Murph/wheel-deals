"use client";

export default function MerchantTermsPage() {
  return (
    <main
      style={{
        padding: "24px 16px 60px",
        maxWidth: 680,
        margin: "0 auto",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        color: "#1a1a1a",
        lineHeight: 1.7,
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: "#d97706" }}>WHEEL DEALS</div>
        <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
          Founding Merchant Terms &amp; Conditions
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
          Version 1.0 — Effective upon acceptance
        </div>
      </div>

      <Section title="1. Overview">
        <p>
          These Founding Merchant Terms &amp; Conditions ("Agreement") govern your participation as a
          merchant on the WheelDeals platform ("WheelDeals," "we," "us"). By checking the acceptance
          box during onboarding, you ("Merchant") agree to be bound by this Agreement in full.
        </p>
      </Section>

      <Section title="2. Founding Merchant Program">
        <p>
          As a Founding Merchant, you are among the first businesses to join the WheelDeals platform.
          Founding Merchant status is limited to the first 1,000 qualifying businesses. This status
          entitles you to the profit share rates described in Section 5 for as long as your account
          remains in good standing.
        </p>
      </Section>

      <Section title="3. Spin Wheel Rules">
        <ul>
          <li>
            <strong>All prizes are non-cash.</strong> Prizes listed on your spin wheel have no cash
            value and cannot be exchanged for money under any circumstances.
          </li>
          <li>
            <strong>A prize is always awarded.</strong> Every spin must result in a prize being
            awarded to the customer. You may not configure a "no prize" or "try again" outcome.
          </li>
          <li>
            <strong>Prizes must be honored.</strong> You are responsible for honoring every prize
            won by a customer at your business. Failure to honor prizes may result in removal from
            the platform.
          </li>
          <li>
            <strong>Accurate prize descriptions.</strong> All prize labels must accurately describe
            what the customer will receive. Misleading or deceptive prize descriptions are prohibited.
          </li>
          <li>
            <strong>Customer disputes.</strong> Your business is solely responsible for handling any
            customer disputes related to prize redemption. WheelDeals is not liable for disputes
            between merchants and customers.
          </li>
        </ul>
      </Section>

      <Section title="4. Merchant Verification">
        <p>
          Merchant accounts do not require verification to onboard or to publish a spin wheel.
          However, <strong>verification is required before any profit share payouts are released</strong>.
          This is a one-time process designed to confirm your business is active and legitimate,
          and to prevent fraudulent or inactive ("ghost") merchant accounts from receiving payments.
        </p>
        <p>
          The WheelDeals team will contact you at your registered email address to complete
          verification. Verification may include confirming your business name, address, and
          a valid government-issued business license or equivalent documentation.
        </p>
      </Section>

      <Section title="5. Profit Share &amp; Earnings">
        <p>
          Merchants earn a percentage of each spin payment after Stripe payment processing fees
          are deducted. The following rates apply:
        </p>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
            marginTop: 12,
          }}
        >
          <thead>
            <tr style={{ background: "#fef3c7" }}>
              <Th>Spin Price</Th>
              <Th>Merchant Earns</Th>
              <Th>WheelDeals Platform</Th>
              <Th>Est. Merchant Payout*</Th>
            </tr>
          </thead>
          <tbody>
            <Tr cells={["$1.35", "70%", "30%", "~$0.72"]} />
            <Tr cells={["$2.00", "70%", "30%", "~$1.10"]} shade />
            <Tr cells={["$3.00", "70%", "30%", "~$1.72"]} />
            <Tr cells={["$5.00", "75%", "25%", "~$3.17"]} shade />
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
          * Estimated after Stripe fees (~2.9% + $0.30 per transaction). Actual payouts may vary
          slightly based on Stripe's current fee schedule.
        </p>
        <p>
          Payouts are processed through Stripe Connect directly to your connected bank account.
          You must connect a Stripe account from your Merchant Dashboard to receive payments.
          WheelDeals does not hold merchant funds.
        </p>
      </Section>

      <Section title="6. Platform Rules &amp; Conduct">
        <ul>
          <li>You must be a legitimate, operating business to participate.</li>
          <li>
            You may not use WheelDeals to promote illegal products or services, adult content,
            gambling (beyond the spin mechanic itself), or any content that violates applicable law.
          </li>
          <li>
            WheelDeals reserves the right to suspend or permanently remove any merchant account
            that violates these terms, at our sole discretion, with or without prior notice.
          </li>
          <li>
            You are responsible for ensuring your prizes comply with all applicable local, state,
            and federal laws and regulations.
          </li>
        </ul>
      </Section>

      <Section title="7. No Upfront Cost">
        <p>
          There is <strong>no fee to sign up</strong> or to publish a spin wheel on WheelDeals.
          WheelDeals earns revenue solely through the platform percentage of each spin as described
          in Section 5. We do not charge monthly fees, setup fees, or listing fees.
        </p>
      </Section>

      <Section title="8. Limitation of Liability">
        <p>
          WheelDeals provides the platform on an "as is" basis. We are not liable for any indirect,
          incidental, or consequential damages arising from your use of the platform, including but
          not limited to lost profits, lost customers, or disputes with customers. Our total
          liability to you shall not exceed the total platform fees collected from your account
          in the 30 days preceding the claim.
        </p>
      </Section>

      <Section title="9. Changes to These Terms">
        <p>
          WheelDeals may update these terms from time to time. We will notify you by email at your
          registered address. Continued use of the platform after notice constitutes acceptance of
          the updated terms.
        </p>
      </Section>

      <Section title="10. Governing Law">
        <p>
          This Agreement is governed by the laws of the State of Nevada, without regard to its
          conflict of law provisions. Any disputes shall be resolved in the courts of Clark County,
          Nevada.
        </p>
      </Section>

      <div
        style={{
          marginTop: 32,
          padding: "16px 20px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          fontSize: 13,
          color: "#6b7280",
          textAlign: "center",
        }}
      >
        By checking the acceptance box on the onboarding page, you confirm that you have read,
        understood, and agree to these Founding Merchant Terms &amp; Conditions.
        <br />
        <br />
        <strong style={{ color: "#1a1a1a" }}>WheelDeals — wheel-deals-nine.vercel.app</strong>
      </div>

      <div style={{ textAlign: "center", marginTop: 24 }}>
        <a
          href="/merchant/onboard"
          style={{
            display: "inline-block",
            padding: "12px 28px",
            background: "linear-gradient(180deg,#FFD700,#FFA500)",
            color: "#1a1a1a",
            fontWeight: 900,
            borderRadius: 12,
            textDecoration: "none",
            fontSize: 15,
            border: "1px solid #d4a017",
          }}
        >
          ← Back to Onboarding
        </a>
      </div>
    </main>
  );
}

// ── Small helper components ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontSize: 16,
          fontWeight: 900,
          color: "#d97706",
          borderBottom: "2px solid #fde68a",
          paddingBottom: 6,
          marginBottom: 12,
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        border: "1px solid #e5e7eb",
        padding: "8px 10px",
        textAlign: "left",
        fontWeight: 800,
        fontSize: 13,
      }}
    >
      {children}
    </th>
  );
}

function Tr({ cells, shade }: { cells: string[]; shade?: boolean }) {
  return (
    <tr style={{ background: shade ? "#fafafa" : "#fff" }}>
      {cells.map((c, i) => (
        <td
          key={i}
          style={{
            border: "1px solid #e5e7eb",
            padding: "8px 10px",
            fontSize: 13,
            fontWeight: i === 0 ? 700 : 400,
          }}
        >
          {c}
        </td>
      ))}
    </tr>
  );
}
