"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import Wheel, { WheelItem } from "@/components/Wheel";


type WheelItem = {
  label: string;
  weight: number;
};

type Merchant = {
  id: string;
  name: string;
  category: string;
  city: string;
  wheel?: WheelItem[];
};

function pickWeighted(items: WheelItem[]): WheelItem {
  const total = items.reduce((sum, it) => sum + (Number(it.weight) || 0), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= Number(it.weight) || 0;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export default function Home() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "merchants"));
      const data: Merchant[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Merchant, "id">),
      }));
      setMerchants(data);
      if (data[0]?.id) setSelectedId(data[0].id);
    })();
  }, []);

  const selectedMerchant = useMemo(
    () => merchants.find((m) => m.id === selectedId) ?? null,
    [merchants, selectedId]
  );

  const wheel = selectedMerchant?.wheel ?? [];

  const onSpin = async () => {
    if (!selectedMerchant) return;
    if (!wheel.length) {
      setResult("No wheel items found for this merchant yet.");
      return;
    }
    setSpinning(true);
    setResult("");

    // Small delay to feel like a spin (we’ll animate later)
    await new Promise((r) => setTimeout(r, 900));

    const win = pickWeighted(wheel);
    setResult(`🎉 You won: ${win.label}`);
    setSpinning(false);
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ marginBottom: 6 }}>Wheel Deals</h1>
      <div style={{ marginBottom: 18 }}>Loaded {merchants.length} merchant(s).</div>

      {merchants.map((m) => (
        <div key={m.id} style={{ marginBottom: 8 }}>
          <label style={{ cursor: "pointer" }}>
            <input
              type="radio"
              name="merchant"
              checked={selectedId === m.id}
              onChange={() => setSelectedId(m.id)}
              style={{ marginRight: 8 }}
            />
            <b>{m.name}</b> — {m.category} — {m.city}
          </label>
        </div>
      ))}

      <hr style={{ margin: "18px 0" }} />

      <h2 style={{ marginBottom: 8 }}>
        {selectedMerchant ? `Spin for ${selectedMerchant.name}` : "Select a merchant"}
      </h2>
<h2 style={{ marginBottom: 8 }}>
  {selectedMerchant
    ? `Spin for ${selectedMerchant.name}`
    : "Select a merchant"}
</h2>

<Wheel
  items={(selectedMerchant?.wheel ?? []) as WheelItem[]}
  onResult={(label) => setResult(label)}
/>
{result && <div style={{ marginTop: 12 }}>🎉 You won: <b>{result}</b></div>}


<button
  onClick={() => {
    if (!selectedMerchant) return;
    if (!wheel.length) {
      setResult("No wheel items found for this merchant yet.");
      return;
    }
    setResult("");
    setSpinning(true);
  }}
  disabled={spinning || !selectedMerchant}
  style={{
    marginTop: 14,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #ccc",
    cursor: spinning ? "not-allowed" : "pointer",
  }}
>
  {spinning ? "Spinning..." : "Spin ($1)"}
</button>

<div style={{ marginTop: 14, fontSize: 18 }}>{result}</div>

      

      <div style={{ marginTop: 14, fontSize: 18 }}>{result}</div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Wheel items:</div>
        {wheel.length ? (
          <ul>
            {wheel.map((it, idx) => (
              <li key={idx}>
                {it.label} (weight {it.weight})
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ opacity: 0.7 }}>
            No wheel items found. Add a <code>wheel</code> array to this merchant in Firestore.
          </div>
        )}
      </div>
    </main>
  );
}
