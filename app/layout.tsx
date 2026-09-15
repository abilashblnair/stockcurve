import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Providers from "@/components/Providers";
import TopBar from "@/components/TopBar";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Stockcurve · Launches quoted in tokenized stocks", template: "%s · Stockcurve" },
  description:
    "Configure, launch and monitor Meteora Dynamic Bonding Curve pools whose quote token is a tokenized stock. Opening-auction fees, USD graduation, locked liquidity.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <TopBar />
          <main>{children}</main>
          <footer className="footer">
            <div className="wrap spread">
              <span>Stockcurve · built on Meteora Dynamic Bonding Curve. Not investment advice. Tokenized stocks are not available to US persons.</span>
              <span className="mono">mainnet</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
