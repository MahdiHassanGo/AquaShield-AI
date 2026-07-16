"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { Prediction } from "@/lib/types";

type HistoryResponse = {
  items: Prediction[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export default function History({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<HistoryResponse>("/predictions?limit=20")
      .then((response) => {
        if (active) setItems(response.items);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function remove(id: string) {
    if (!window.confirm("Delete this prediction record from system history?")) return;
    try {
      await apiRequest(`/predictions/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the record.");
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">DIAGNOSTIC ARCHIVE</p>
          <h2>Prediction History Logs</h2>
        </div>
      </div>
      
      {error && <p className="alert alert-error">{error}</p>}
      
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "20px 0", color: "var(--primary)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1.2s linear infinite" }}><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          <p className="muted" style={{ margin: 0, fontWeight: 500 }}>Retrieving system database entries...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted)", marginBottom: "12px" }}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="9"></line><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="13" y2="17"></line></svg>
          <p style={{ margin: 0 }}>No diagnostic sessions recorded on this device yet.</p>
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Specimen File</th>
                <th>Diagnostic Class</th>
                <th>Inference Confidence</th>
                <th>Ensemble Size</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td style={{ fontFamily: "monospace", color: "var(--muted)", fontSize: "0.85rem" }}>{item.originalFileName}</td>
                  <td>
                    <span className={`status status-${item.predictedClass.toLowerCase()}`}>
                      {item.predictedClass === "BG_WSSV" ? "BG & WSSV" : item.predictedClass}
                    </span>
                  </td>
                  <td style={{ fontFamily: "Orbitron, sans-serif", fontWeight: 700, color: "#fff" }}>
                    {(item.confidence * 100).toFixed(1)}%
                  </td>
                  <td style={{ textAlign: "center", color: "var(--primary)" }}>{item.ensembleSize}x</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="danger-link" type="button" onClick={() => remove(item.id)} style={{ display: "inline-flex", alignItems: "center" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
