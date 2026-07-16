import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <section className="hero-section">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">Advanced Computer Vision for Aquaculture</p>
            <h1>
              Next-Gen <span className="gradient-text">Disease Diagnostics</span> for Shrimp Farming
            </h1>
            <p className="hero-copy">
              An advanced research prototype utilizing a five-fold EfficientNet-B0 neural network 
              ensemble to classify health and disease patterns (Healthy, BG, WSSV, BG_WSSV) from digital images.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/register">
                Start Diagnostics
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
              </Link>
              <Link className="button button-secondary" href="/login">
                Researcher Log in
              </Link>
            </div>
          </div>
          <div className="architecture-card glass-panel">
            <div style={{ padding: "16px 20px 8px 20px" }}>
              <p className="eyebrow" style={{ margin: 0 }}>System Pipeline</p>
              <h3 style={{ margin: "4px 0 0 0", fontSize: "1.15rem", color: "#fff" }}>Diagnostics Workflow</h3>
            </div>
            <div>
              <span>01</span>
              <div>
                <strong>Capture Image</strong>
                <small>Upload high-resolution camera photos, local gallery images, or microscope files.</small>
              </div>
            </div>
            <div>
              <span>02</span>
              <div>
                <strong>Normalize</strong>
                <small>RGB conversion, 224×224 bicubic resizing, and standard ImageNet channel scaling.</small>
              </div>
            </div>
            <div>
              <span>03</span>
              <div>
                <strong>Ensemble Inference</strong>
                <small>Compute class logits using our five trained EfficientNet convolutional models.</small>
              </div>
            </div>
            <div>
              <span>04</span>
              <div>
                <strong>Secure Storage</strong>
                <small>Archive classification history, parameters, and metadata safely in PostgreSQL.</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container feature-section">
        <article className="feature-card glass-panel">
          <div style={{ marginBottom: "16px", color: "var(--primary)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M12 6v6l4 2"></path></svg>
          </div>
          <h2>Consistent Preprocessing</h2>
          <p>Ensures inference fidelity by standardizing inputs to 224×224 pixels with precise bicubic interpolation and standard deviation scaling.</p>
        </article>
        
        <article className="feature-card glass-panel">
          <div style={{ marginBottom: "16px", color: "var(--primary)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
          <h2>Secure Upload Controls</h2>
          <p>Protects system integrity via token authentication, MIME validation, strict 8 MB payload limits, and server-side request rate limits.</p>
        </article>
        
        <article className="feature-card glass-panel">
          <div style={{ marginBottom: "16px", color: "var(--primary)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
          </div>
          <h2>Transparent Output</h2>
          <p>Delivers full diagnostic clarity displaying class probability charts, ensemble confidence indexes, and warnings for low-confidence results.</p>
        </article>
      </section>
    </main>
  );
}
