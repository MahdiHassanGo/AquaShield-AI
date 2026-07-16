"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { PredictionResponse } from "@/lib/types";

const diseaseDescriptions: Record<string, string> = {
  Healthy: "No target disease pattern was detected. Specimen appears healthy.",
  BG: "Black Gill disease pattern detected. Characterized by melanized lesions in the gills.",
  WSSV: "White Spot Syndrome Virus (WSSV) detected. Extremely contagious; seek lab quarantine validation.",
  BG_WSSV: "Co-infection of Black Gill and WSSV detected. Immediate quarantine and expert review required."
};

const classPrettyNames: Record<string, string> = {
  Healthy: "Healthy Specimen",
  BG: "Black Gill (BG)",
  WSSV: "WSSV Positive",
  BG_WSSV: "BG & WSSV Co-infection"
};

export default function Classifier({ onSaved }: { onSaved: () => void }) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<PredictionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(selected.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (selected.size > 8 * 1024 * 1024) {
      setError("The image must be 8 MB or smaller.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setResult(null);
    setError("");
  }

  async function classify() {
    if (!file) {
      setError("Capture or choose an image first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await apiRequest<PredictionResponse>("/predictions", {
        method: "POST",
        body: formData
      });
      setResult(response);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Classification failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel classifier-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">neural classification</p>
          <h2>Specimen Scan & Inference</h2>
        </div>
        <span className="model-chip">EfficientNet-B0 ensemble</span>
      </div>

      <input
        ref={cameraInput}
        className="visually-hidden"
        type="file"
        aria-label="Capture with Camera"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={chooseFile}
      />
      <input
        ref={galleryInput}
        className="visually-hidden"
        type="file"
        aria-label="Upload from files"
        accept="image/jpeg,image/png,image/webp"
        onChange={chooseFile}
      />

      <div className="upload-grid">
        <div className="preview-box">
          {preview ? (
            <>
              <img src={preview} alt="Selected shrimp preview" />
              {loading && <div className="scanner-overlay" />}
            </>
          ) : (
            <div className="empty-preview">
              <span className="empty-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
              </span>
              <strong>No image loaded</strong>
              <span>Capture a close-up photo of the shrimp specimen under clear, bright lighting.</span>
            </div>
          )}
        </div>

        <div className="upload-actions">
          <button className="button" type="button" onClick={() => cameraInput.current?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            Capture Camera
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => galleryInput.current?.click()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Select Specimen File
          </button>
          <button
            className="button button-dark"
            type="button"
            onClick={classify}
            disabled={!file || loading}
          >
            {loading ? "Analyzing Specimen..." : "Initiate Diagnostics"}
          </button>
          <p className="small muted" style={{ textAlign: "center", margin: 0 }}>
            Supported formats: JPEG, PNG, WebP (Max 8 MB)
          </p>
        </div>
      </div>

      {error && <p className="alert alert-error">{error}</p>}

      {result && (
        <div className="result-card" aria-live="polite">
          <div className="result-main">
            <div style={{ flex: 1 }}>
              <p className="eyebrow">DIAGNOSTIC OUTCOME</p>
              <h3>{classPrettyNames[result.prediction.predictedClass] || result.prediction.predictedClass}</h3>
              <p className="muted" style={{ margin: 0, fontSize: "0.95rem" }}>
                {diseaseDescriptions[result.prediction.predictedClass]}
              </p>
            </div>
            
            <div className="confidence-gauge-container">
              <svg width="120" height="120" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
                {/* Underlay Track */}
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="transparent"
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeWidth="8"
                />
                {/* Progress Circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="transparent"
                  stroke="var(--primary)"
                  strokeWidth="8"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 - (result.confidencePercentage / 100) * 251.2}
                  strokeLinecap="round"
                  style={{
                    filter: "drop-shadow(0 0 6px var(--primary-glow))",
                    transition: "stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)"
                  }}
                />
              </svg>
              <div className="confidence-gauge-text">
                <strong>{result.confidencePercentage.toFixed(0)}%</strong>
                <span>CONFIDENCE</span>
              </div>
            </div>
          </div>

          {result.prediction.lowConfidence && (
            <p className="alert alert-warning">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              Critical Alert: Low confidence diagnostics. Re-capture image under optimal lighting and submit for laboratory diagnosis.
            </p>
          )}

          <div className="probability-list">
            {Object.entries(result.prediction.probabilities)
              .sort((a, b) => b[1] - a[1])
              .map(([label, probability]) => {
                const rowClass = label.toLowerCase() + "-row";
                return (
                  <div className={`probability-row ${rowClass}`} key={label}>
                    <span>{label}</span>
                    <div className="probability-track">
                      <div style={{ width: `${Math.min(100, probability * 100)}%` }} />
                    </div>
                    <strong>{(probability * 100).toFixed(1)}%</strong>
                  </div>
                );
              })}
          </div>
          <p className="disclaimer">{result.disclaimer}</p>
        </div>
      )}
    </section>
  );
}
