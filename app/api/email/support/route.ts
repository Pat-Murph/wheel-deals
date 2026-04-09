import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const WHEELDEALS_EMAIL = "pat@wheeldealsapp.com";
const FROM_EMAIL = "WheelDeals <support@wheeldealsapp.com>";

export async function POST(req: NextRequest) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { name, email, message, merchantId, merchantName } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const senderName = name?.trim() || "Anonymous User";
    const senderEmail = email?.trim() || "Not provided";
    const mId = merchantId || "N/A";
    const mName = merchantName || "N/A";
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });

    // ── 1. Notification to WheelDeals team ──────────────────────────────────
    await resend.emails.send({
      from: FROM_EMAIL,
      to: WHEELDEALS_EMAIL,
      replyTo: senderEmail !== "Not provided" ? senderEmail : undefined,
      subject: `[Support] New message from ${senderName}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#3b82f6,#6366f1);padding:20px 24px;border-radius:12px 12px 0 0;">
            <h2 style="color:#fff;margin:0;font-size:20px;">New Support Message</h2>
            <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">${timestamp} (PT)</p>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <table style="border-collapse:collapse;width:100%;font-size:14px;">
              <tr>
                <td style="padding:8px 12px;font-weight:bold;background:#f9fafb;border:1px solid #e5e7eb;width:140px;">From</td>
                <td style="padding:8px 12px;border:1px solid #e5e7eb;">${senderName}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-weight:bold;background:#f9fafb;border:1px solid #e5e7eb;">Email</td>
                <td style="padding:8px 12px;border:1px solid #e5e7eb;">${senderEmail !== "Not provided" ? `<a href="mailto:${senderEmail}" style="color:#3b82f6;">${senderEmail}</a>` : "Not provided"}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-weight:bold;background:#f9fafb;border:1px solid #e5e7eb;">Merchant</td>
                <td style="padding:8px 12px;border:1px solid #e5e7eb;">${mName} <span style="color:#9ca3af;font-size:12px;">(${mId})</span></td>
              </tr>
            </table>
            <div style="margin-top:20px;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
              <p style="margin:0 0 8px;font-weight:bold;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
              <p style="margin:0;font-size:14px;line-height:1.7;white-space:pre-wrap;">${message.trim()}</p>
            </div>
            ${senderEmail !== "Not provided" ? `<p style="margin-top:16px;font-size:13px;color:#6b7280;">Reply directly to this email to respond to the customer.</p>` : ""}
          </div>
        </div>
      `,
    });

    // ── 2. Confirmation email to customer (if they provided email) ───────────
    if (senderEmail !== "Not provided") {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: senderEmail,
        subject: `We received your message — WheelDeals Support`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#d97706,#f59e0b);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
              <h1 style="color:#fff;margin:0;font-size:22px;">We Got Your Message!</h1>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
              <p style="font-size:15px;">Hi ${senderName},</p>
              <p style="font-size:14px;line-height:1.7;">Thank you for reaching out to WheelDeals Support. We've received your message and will get back to you as soon as possible — typically within 24 hours.</p>
              <div style="margin:20px 0;padding:16px;background:#fefce8;border:1px solid #fde68a;border-radius:8px;">
                <p style="margin:0 0 6px;font-weight:bold;font-size:13px;color:#92400e;">Your Message:</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#78350f;white-space:pre-wrap;">${message.trim()}</p>
              </div>
              <p style="font-size:14px;line-height:1.7;">If you need to add anything, just reply to this email.</p>
              <p style="font-size:13px;color:#6b7280;margin-top:24px;">— The WheelDeals Team</p>
            </div>
          </div>
        `,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Support email error:", err);
    return NextResponse.json({ error: err.message ?? "Email failed" }, { status: 500 });
  }
}
