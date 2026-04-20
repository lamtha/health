import Link from "next/link";

import { PageHeader } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listRecentBatches } from "@/lib/batch-runner";

import { UploadsDropzone } from "./uploads-client";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function UploadsPage() {
  const batches = listRecentBatches();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="uploads" />
      <PageHeader
        crumbs={["Dashboard", "Upload"]}
        title="Upload reports"
        subtitle="Drop one or many PDFs. Each upload is tracked server-side — nav away and come back anytime."
      />

      <div className="space-y-6 px-8 pb-10">
        <UploadsDropzone />

        <Card className="py-0">
          <div className="border-b px-5 py-3">
            <div className="text-[13px] font-medium">Recent uploads</div>
            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
              {batches.length === 0
                ? "nothing uploaded yet"
                : `${batches.length} most recent · click to inspect`}
            </div>
          </div>
          {batches.length === 0 ? (
            <CardContent className="px-5 py-6 text-[12.5px] text-muted-foreground">
              Drop a PDF above to get started.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Started</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                  <TableHead className="text-right">Duplicate</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="pr-5 text-right">In flight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => {
                  const saved = b.counts.saved ?? 0;
                  const dupe = b.counts.duplicate ?? 0;
                  const err = b.counts.error ?? 0;
                  const inFlight =
                    (b.counts.queued ?? 0) + (b.counts.extracting ?? 0);
                  return (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-muted/40"
                    >
                      <TableCell className="pl-5 font-mono text-[11.5px]">
                        <Link href={`/uploads/${b.id}`} className="block">
                          #{b.id} · {formatDate(b.createdAt)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12.5px]">
                        <Link href={`/uploads/${b.id}`} className="block">
                          {b.totalCount}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12.5px] text-flag-ok">
                        <Link href={`/uploads/${b.id}`} className="block">
                          {saved}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12.5px] text-muted-foreground">
                        <Link href={`/uploads/${b.id}`} className="block">
                          {dupe}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12.5px]">
                        <Link
                          href={`/uploads/${b.id}`}
                          className={
                            err > 0
                              ? "block text-destructive"
                              : "block text-muted-foreground"
                          }
                        >
                          {err}
                        </Link>
                      </TableCell>
                      <TableCell className="pr-5 text-right font-mono text-[12.5px]">
                        <Link
                          href={`/uploads/${b.id}`}
                          className={
                            inFlight > 0
                              ? "block text-primary"
                              : "block text-muted-foreground"
                          }
                        >
                          {inFlight}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
