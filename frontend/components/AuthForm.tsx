"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api";
import { saveSession } from "@/lib/auth";
import type { User } from "@/lib/types";

type AuthResponse = { user: User; token: string };

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const body =
      mode === "register"
        ? {
            name: String(form.get("name") ?? ""),
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? "")
          }
        : {
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? "")
          };

    try {
      const result = await apiRequest<AuthResponse>(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(body),
        authenticated: false
      });
      saveSession(result.token, result.user);
      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-card">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px", color: "var(--primary)" }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 8px rgba(6, 182, 212, 0.4))" }}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 11 2 2 4-4" />
        </svg>
      </div>

      <p className="eyebrow" style={{ textAlign: "center", display: "flex", justifyContent: "center" }}>Secure Portal</p>
      <h1 style={{ textAlign: "center", fontSize: "1.8rem" }}>{mode === "login" ? "Welcome back" : "Create account"}</h1>
      <p className="muted" style={{ textAlign: "center", fontSize: "0.9rem", marginBottom: "28px" }}>
        {mode === "login"
          ? "Log in to access your dashboard and start diagnostics."
          : "Register to save model predictions and confidence history."}
      </p>

      <form className="form-stack" onSubmit={submit}>
        {mode === "register" && (
          <label>
            Full name
            <input 
              name="name" 
              placeholder="Dr. Sarah Jenkins"
              minLength={2} 
              maxLength={80} 
              required 
              autoComplete="name" 
            />
          </label>
        )}
        <label>
          Email address
          <input 
            name="email" 
            type="email" 
            placeholder="sarah.j@aquashield.ai"
            required 
            autoComplete="email" 
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            placeholder="••••••••"
            required
            minLength={mode === "register" ? 8 : 1}
            maxLength={72}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
        </label>
        {error && <p className="alert alert-error">{error}</p>}
        <button className="button button-full" disabled={loading} type="submit" style={{ marginTop: "12px" }}>
          {loading ? "Establishing session…" : mode === "login" ? "Sign In" : "Register Credentials"}
        </button>
      </form>

      <p className="auth-switch">
        {mode === "login" ? "New researcher?" : "Already registered?"}{" "}
        <Link href={mode === "login" ? "/register" : "/login"}>
          {mode === "login" ? "Request Access" : "Sign In"}
        </Link>
      </p>
    </section>
  );
}
