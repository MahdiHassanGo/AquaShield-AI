"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clearSession, getStoredUser } from "@/lib/auth";
import type { User } from "@/lib/types";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const refresh = () => setUser(getStoredUser());
    refresh();
    window.addEventListener("auth-change", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("auth-change", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  function logout() {
    clearSession();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="site-header">
      <div className="container nav-row">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(0 0 8px rgba(6, 182, 212, 0.4))" }}>
              {/* Target crosshairs */}
              <path d="M18 2v3M18 31v3M2 18h3M31 18h3" stroke="var(--primary)" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
              {/* Scanning outer rings */}
              <circle cx="18" cy="18" r="14" stroke="var(--primary)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
              <circle cx="18" cy="18" r="11" stroke="var(--primary)" strokeWidth="0.5" opacity="0.3" />
              {/* Shrimp curved body */}
              <path d="M23 13C21.2 10.8 17.8 10.4 15.2 12.5C12.6 14.6 12.2 18.0 14.3 20.6C15.2 21.6 16.5 22.3 18.2 22.3" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
              {/* Shrimp segments */}
              <path d="M20.5 14.2C19.5 13.2 18 13 16.8 13.8" stroke="var(--primary)" strokeWidth="1" strokeLinecap="round" />
              <path d="M18.8 16.8C18.1 16.1 17.1 16 16.2 16.4" stroke="var(--primary)" strokeWidth="1" strokeLinecap="round" />
              {/* Antennae */}
              <path d="M23 13C25.2 11.7 27.4 11.3 29.2 11.7" stroke="var(--primary)" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
              <path d="M23 13C24.3 15.2 25.2 17.8 25.6 20.4" stroke="var(--primary)" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
              {/* Tail Fan */}
              <path d="M18.2 22.3L17.3 25.3M18.2 22.3L19.4 24.9M18.2 22.3L21.1 24.1" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" />
              {/* Core scanning dot */}
              <circle cx="18" cy="18" r="1.5" fill="var(--primary)" />
            </svg>
          </span>
          <span className="brand-text">AquaShield AI</span>
        </Link>
        
        <nav className="nav-links" aria-label="Main navigation">
          <Link href="/" className={pathname === "/" ? "active" : ""}>Home</Link>
          {user ? (
            <>
              <Link href="/dashboard" className={pathname === "/dashboard" ? "active" : ""}>Dashboard</Link>
              <button className="link-button" onClick={logout} type="button">
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={pathname === "/login" ? "active" : ""}>Log in</Link>
              <Link className="button button-small" href="/register">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
