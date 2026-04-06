"use client";
export const dynamic = "force-dynamic";
/**
 * /admin/profit-share
 *
 * Internal admin page for tracking the Founding Merchant Profit Share Program.
 *
 * Program Terms:
 *   - First 1,000 merchants = Founding Merchants
 *   - 20% of Wheel Deals net profit distributed quarterly
 *   - Starts on 1st anniversary of launch
 *   - Lasts 5 years (20 quarterly distributions)
 *   - Each merchant's share is weighted by their cumulative revenue generated
 *
 * This page shows:
 *   - Total founding merchants enrolled
 *   - Spots remaining
 *   - List of all founding merchants with their revenue and calculated share
 *   - Quarterly distribution history
 */

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  doc,
  getDoc,
} from "firebase/firestore";
import { getDb } from "../../../lib/firebase";
import { FOUNDING_MERCHANT_LIMIT } from "../../../lib/founding";

const SHARE_PERCENT = 20;
const PROGRAM_YEARS = 5;
const QUARTERS_TOTAL = PROGRAM_YEARS * 4; // 20 distributions

type FoundingMerchant = {
  id: string;
  name: string;
  foundingNumber: number;
  foundingJoinedAt: any;
  city?: string;
  category?: string;
  totalRevenueCents: number;
};

function fmt$(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function card(): React.CSSProperties {
  return {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 20,
    background: "white",
    boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
  };
}

export default function ProfitShareAdminPage() {
  const [merchants, setMerchants] = useState<FoundingMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalFoundingCount, setTotalFoundingCount] = useState(0);

  // For the quarterly calculator
  const [netProfitInput, setNetProfitInput] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch all founding merchants
        const q = query(
          collection(getDb(), "merchants"),
          where("foundingMerchant", "==", true),
          orderBy("foundingNumber", "asc")
        );
        const snap = await getDocs(q);

        // For each founding merchant, fetch their total revenue from merchantStats
        const results: FoundingMerchant[] = [];

        for (const docSnap of snap.docs) {
          const data = docSnap.data() as any;

          // Sum all daily stats for this merchant
          const statsSnap = await getDocs(
            collection(getDb(), "merchantStats", docSnap.id, "daily")
          );
          const totalRevenueCents = statsSnap.docs.reduce((sum, d) => {
            const rev = (d.data() as any).revenueCents ?? 0;
            return sum + rev;
          }, 0);

          results.push({
            id: docSnap.id,
            name: data.name ?? "Unknown",
            foundingNumber: data.foundingNumber ?? 0,
            foundingJoinedAt: data.foundingJoinedAt,
            city: data.city,
            category: data.category,
            totalRevenueCents,
          });
        }

        setMerchants(results);
        setTotalFoundingCount(results.length);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load founding merchants.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalRevenueCents = merchants.reduce((s, m) => s + m.totalRevenueCents, 0);
  const spotsRemaining = FOUNDING_MERCHANT_LIMIT - totalFoundingCount;

  // Quarterly share calculator
  const netProfitCents = Math.round((parseFloat(netProfitInput) || 0) * 100);
  const totalShareCents = Math.round(netProfitCents * (SHARE_PERCENT / 100));

  const merchantsWithShare = merchants.map((m) => ({
    ...m,
    sharePercent:
      totalRevenueCents > 0 ? (m.totalRevenueCents / totalRevenueCents) * 100 : 0,
    shareCents:
      totalRevenueCents > 0
        ? Math.round((m.totalRevenueCents / totalRevenueCents) * totalShareCents)
        : 0,
  }));

  return (
    <main
      style={{
        padding: 24,
        display: "grid",
        gap: 20,
        maxWidth: 1100,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 1000 }}>
            Founding Merchant Profit Share
          </div>
          <div style={{ opacity: 0.65, fontWeight: 800, marginTop: 4 }}>
            20% net profit · Quarterly · 5 years · Revenue-weighted · Starts Year 1 anniversary
          </div>
        </div>
        <a href="/merchant" style={{ fontWeight: 900, textDecoration: "none", color: "#111" }}>
          ← Dashboard
        </a>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        {[
          { label: "Founding Merchants", value: totalFoundingCount.toLocaleString(), sub: `of ${FOUNDING_MERCHANT_LIMIT}` },
          { label: "Spots Remaining", value: spotsRemaining.toLocaleString(), sub: "until program closes" },
          { label: "Total Revenue (Weighted)", value: fmt$(totalRevenueCents), sub: "cumulative unlock revenue" },
          { label: "Quarterly Distributions", value: `${QUARTERS_TOTAL}`, sub: `over ${PROGRAM_YEARS} years` },
          { label: "Share Rate", value: `${SHARE_PERCENT}%`, sub: "of net profit per quarter" },
        ].map((s) => (
          <div key={s.label} style={{ ...card(), textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 1000, color: "#F4B400" }}>{s.value}</div>
            <div style={{ fontWeight: 900, fontSize: 13, marginTop: 4 }}>{s.label}</div>
            <div style={{ opacity: 0.6, fontSize: 11, fontWeight: 800 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Quarterly Calculator */}
      <div style={card()}>
        <div style={{ fontWeight: 1000, fontSize: 17, marginBottom: 12 }}>
          Quarterly Distribution Calculator
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontWeight: 900 }}>Net Profit for Quarter ($):</label>
          <input
            type="number"
            value={netProfitInput}
            onChange={(e) => setNetProfitInput(e.target.value)}
            placeholder="e.g. 50000"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
              fontSize: 16,
              fontWeight: 900,
              width: 180,
            }}
          />
          {netProfitCents > 0 && (
            <div style={{ fontWeight: 900, color: "#16a34a" }}>
              → Total to distribute: <strong>{fmt$(totalShareCents)}</strong> ({SHARE_PERCENT}% of {fmt$(netProfitCents)})
            </div>
          )}
        </div>
        {netProfitCents > 0 && totalRevenueCents === 0 && (
          <div style={{ marginTop: 10, opacity: 0.7, fontWeight: 800, fontSize: 13 }}>
            ⚠️ No revenue recorded yet — all merchants would receive equal shares once revenue is tracked.
          </div>
        )}
      </div>

      {/* Founding Merchants Table */}
      {loading ? (
        <div style={{ fontWeight: 900, opacity: 0.7 }}>Loading founding merchants…</div>
      ) : error ? (
        <div style={{ fontWeight: 900, color: "#dc2626" }}>❌ {error}</div>
      ) : merchants.length === 0 ? (
        <div style={{ ...card(), fontWeight: 900, opacity: 0.7 }}>
          No founding merchants yet. The first merchant to sign up will be #1.
        </div>
      ) : (
        <div style={card()}>
          <div style={{ fontWeight: 1000, fontSize: 17, marginBottom: 14 }}>
            Founding Merchants ({totalFoundingCount})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #f3f4f6" }}>
                  {["#", "Merchant", "City", "Category", "Joined", "Revenue", "Rev %", netProfitCents > 0 ? "Est. Share" : null]
                    .filter(Boolean)
                    .map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "8px 12px",
                          textAlign: "left",
                          fontWeight: 1000,
                          opacity: 0.7,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {merchantsWithShare.map((m, i) => (
                  <tr
                    key={m.id}
                    style={{
                      borderBottom: "1px solid #f3f4f6",
                      background: i % 2 === 0 ? "white" : "#fafafa",
                    }}
                  >
                    <td style={{ padding: "10px 12px", fontWeight: 1000, color: "#F4B400" }}>
                      #{m.foundingNumber}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 900 }}>{m.name}</td>
                    <td style={{ padding: "10px 12px", opacity: 0.8, fontWeight: 800 }}>{m.city ?? "—"}</td>
                    <td style={{ padding: "10px 12px", opacity: 0.8, fontWeight: 800 }}>{m.category ?? "—"}</td>
                    <td style={{ padding: "10px 12px", opacity: 0.7, fontWeight: 800, whiteSpace: "nowrap" }}>
                      {m.foundingJoinedAt?.toDate
                        ? m.foundingJoinedAt.toDate().toLocaleDateString()
                        : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 900 }}>
                      {fmt$(m.totalRevenueCents)}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 900 }}>
                      {totalRevenueCents > 0
                        ? `${m.sharePercent.toFixed(2)}%`
                        : "—"}
                    </td>
                    {netProfitCents > 0 && (
                      <td style={{ padding: "10px 12px", fontWeight: 1000, color: "#16a34a" }}>
                        {fmt$(m.shareCents)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Program Notes */}
      <div style={{ ...card(), background: "#fffbeb", border: "1px solid rgba(244,180,0,0.3)" }}>
        <div style={{ fontWeight: 1000, fontSize: 15, marginBottom: 10, color: "#92400e" }}>
          Program Notes
        </div>
        <div style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 800, color: "#78350f" }}>
          <div>• First {FOUNDING_MERCHANT_LIMIT.toLocaleString()} merchants to create an account qualify as Founding Merchants.</div>
          <div>• {SHARE_PERCENT}% of Wheel Deals <strong>net profit</strong> is distributed quarterly to all Founding Merchants.</div>
          <div>• Distributions are <strong>revenue-weighted</strong>: each merchant's share = their revenue ÷ total founding merchant revenue × total share pool.</div>
          <div>• Program starts on the <strong>1st anniversary</strong> of Wheel Deals launch and runs for <strong>{PROGRAM_YEARS} years</strong> ({QUARTERS_TOTAL} quarterly payments).</div>
          <div>• Revenue is tracked via <code>merchantStats/{"{merchantId}"}/daily</code> in Firestore.</div>
          <div>• To set the launch date, update <code>/platform/founding.launchDate</code> in Firestore.</div>
        </div>
      </div>
    </main>
  );
}
