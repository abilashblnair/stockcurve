import type { Metadata } from "next";
import PoolMonitor from "@/components/PoolMonitor";

export const metadata: Metadata = { title: "Pool monitor" };

export default async function PoolPage({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<{ launched?: string }> }) {
  const { address } = await params;
  const { launched } = await searchParams;
  return (
    <div className="wrap page">
      <PoolMonitor address={address} launched={launched} />
    </div>
  );
}
