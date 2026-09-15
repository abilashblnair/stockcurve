import type { Metadata } from "next";
import PoolTable from "@/components/PoolTable";

export const metadata: Metadata = { title: "Stock-quoted pools" };

export default function PoolsPage() {
  return (
    <div className="wrap page">
      <div className="page-head">
        <span className="eyebrow">Pool monitor</span>
        <h1>Every DBC pool priced in a tokenized stock</h1>
        <p>Indexed straight from the Meteora DBC program on mainnet: configs whose quote token is an xStock, and every pool created under them.</p>
      </div>
      <PoolTable />
    </div>
  );
}
