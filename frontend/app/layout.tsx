import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "AquaShield AI — Shrimp Disease Classification",
  description: "Advanced computer vision screening system for shrimp disease patterns in aquaculture research."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        {children}
        <footer className="site-footer">
          <div className="container">
            © {new Date().getFullYear()} AquaShield AI. Experimental research screening system—not a substitute for laboratory diagnosis.
          </div>
        </footer>
      </body>
    </html>
  );
}
