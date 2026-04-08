export default function DeleteAccountPage() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px", fontFamily: "system-ui, sans-serif", lineHeight: 1.6, color: "#333" }}>
      <h1 style={{ fontSize: 32, fontWeight: 900, marginBottom: 10, color: "#111" }}>Account Deletion Request</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 30 }}>Effective Date: April 7, 2026</p>

      <p style={{ marginBottom: 20 }}>
        At Wheel Deals, we respect your privacy and your right to control your personal data. If you would like to delete your account and all associated data, please follow the instructions below.
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 30, marginBottom: 15, color: "#111" }}>How to Request Account Deletion</h2>
      <p style={{ marginBottom: 15 }}>
        To request the deletion of your Wheel Deals account and associated data, please send an email to our support team:
      </p>
      
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <p style={{ margin: "0 0 10px 0", fontWeight: 700 }}>Email: <a href="mailto:support@wheeldealsapp.com" style={{ color: "#2563eb", textDecoration: "none" }}>support@wheeldealsapp.com</a></p>
        <p style={{ margin: "0 0 10px 0", fontWeight: 700 }}>Subject: Account Deletion Request</p>
        <p style={{ margin: 0 }}>Please include the email address associated with your account in the body of the email so we can locate your data.</p>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 30, marginBottom: 15, color: "#111" }}>What Happens When Your Account is Deleted?</h2>
      <ul style={{ marginBottom: 20, paddingLeft: 20 }}>
        <li style={{ marginBottom: 8 }}>Your account profile and login credentials will be permanently removed.</li>
        <li style={{ marginBottom: 8 }}>Any unused deals or unlocks associated with your account will be forfeited and cannot be recovered.</li>
        <li style={{ marginBottom: 8 }}>Your personal information (such as email address) will be deleted from our active databases.</li>
        <li style={{ marginBottom: 8 }}>Some anonymized or aggregated data may be retained for analytics and reporting purposes, but it will no longer be linked to you.</li>
        <li style={{ marginBottom: 8 }}>If you are a merchant, your business profile and active deals will be removed from the platform.</li>
      </ul>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 30, marginBottom: 15, color: "#111" }}>Data Retention</h2>
      <p style={{ marginBottom: 20 }}>
        Please note that we may be required to retain certain information for legal, tax, or regulatory purposes (such as records of financial transactions) even after your account is deleted. This data will be kept securely and only for as long as required by law.
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginTop: 30, marginBottom: 15, color: "#111" }}>Processing Time</h2>
      <p style={{ marginBottom: 20 }}>
        We will process your account deletion request within 30 days of receipt. We may contact you to verify your identity before completing the deletion process to ensure the security of your account.
      </p>

      <div style={{ marginTop: 50, paddingTop: 20, borderTop: "1px solid #eee", fontSize: 14, color: "#666", textAlign: "center" }}>
        &copy; {new Date().getFullYear()} Wheel Deals. All rights reserved.
      </div>
    </div>
  );
}
