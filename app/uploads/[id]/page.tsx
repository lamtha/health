import { notFound } from "next/navigation";

import { PageHeader } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { getBatch } from "@/lib/batch-runner";

import { BatchDetailClient } from "./batch-detail-client";

export const dynamic = "force-dynamic";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batchId = Number(id);
  if (!Number.isFinite(batchId)) notFound();

  const initial = getBatch(batchId);
  if (!initial) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="uploads" />
      <PageHeader
        crumbs={["Dashboard", "Uploads", `#${initial.id}`]}
        title={`Batch #${initial.id}`}
        subtitle="Live status — updates automatically while items are in flight."
      />
      <BatchDetailClient initial={initial} />
    </div>
  );
}
