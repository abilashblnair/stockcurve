import type { Metadata } from "next";
import PoolTable from "@/components/PoolTable";

export const metadata: Metadata = { title: "Stock-quoted pools" };

export default function PoolsPage() {
  return (
    <div className="wrap page">
      <div className="page-head">
        <span className="eyebrow">Pool monitor</span>
        <h1>Every DBC pool priced in a tokenized stock</h1>
        <p>The cross-pool view of stock-as-quote launches: every Meteora DBC config whose quote is a supported xStock, and every pool under it. Filter by stock, by bonding or graduated, or to launches from this desk. The reserve, the fee and the issuer&apos;s controls belong to that stock.</p>
      </div>
      <PoolTable />
    </div>
  );
}
