import { NextResponse } from "next/server";

import { searchAll } from "@/lib/search";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const result = searchAll(q);
  return NextResponse.json(result);
}
