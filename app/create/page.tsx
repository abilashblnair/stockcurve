import type { Metadata } from "next";
import Builder from "@/components/Builder";

export const metadata: Metadata = { title: "Launch a stock-quoted pool" };

export default function CreatePage() {
  return (
    <div className="wrap page">
      <div className="page-head">
        <span className="eyebrow">Config builder</span>
        <h1>Launch a token priced in a stock</h1>
        <p>Pick the stock buyers pay with, set how the opening trades, and choose when it graduates. The preview uses Meteora&apos;s own curve maths.</p>
      </div>
      <Builder />
    </div>
  );
}
