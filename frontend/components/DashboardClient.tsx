"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getStoredUser, getToken } from "@/lib/auth";
import Classifier from "./Classifier";
import History from "./History";

export default function DashboardClient() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const user = getStoredUser();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <main className="container dashboard-shell" style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center", color: "var(--primary)" }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" style={{ animation: "spin 1s linear infinite", marginBottom: "16px" }}>
            <line x1="12" y1="2" x2="12" y2="6"></line>
            <line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
            <line x1="2" y1="12" x2="6" y2="12"></line>
            <line x1="18" y1="12" x2="22" y2="12"></line>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
          </svg>
          <p style={{ fontWeight: 600, fontSize: "1.1rem" }}>Authenticating security tokens…</p>
        </div>
        <style jsx global>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </main>
    );
  }

  return (
    <main className="container dashboard-shell">
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">DIAGNOSTICS PANEL</p>
          <h1>Welcome, {user?.name?.split(" ")[0] ?? "Researcher"}</h1>
          <p>
            Capture or upload a specimen image. The model service performs real-time bicubic interpolation, 
            norm-scaling, and deep ensemble class probability mapping.
          </p>
        </div>
        
        <div style={{ display: "flex", gap: "16px" }}>
          <div className="hero-stat">
            <strong>4</strong>
            <span>Model Classes</span>
          </div>
          <div className="hero-stat" style={{ borderLeft: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "48px", marginBottom: "4px" }}>
              <span className="model-chip" style={{ margin: 0 }}>ACTIVE</span>
            </div>
            <span>System Status</span>
          </div>
        </div>
      </section>
      
      <Classifier onSaved={() => setRefreshKey((key) => key + 1)} />
      <History refreshKey={refreshKey} />
    </main>
  );
}
