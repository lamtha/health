import type { DiagnosticReview } from "@/lib/diagnostic-review";

type MedicationReview = NonNullable<DiagnosticReview["medications"]>;
function MedicationTable({ rows, sourceId }: { rows: MedicationReview["recent"]; sourceId: string }) {
  return <div className="mt-4 overflow-x-auto print:overflow-visible"><table className="w-full text-left text-xs">
    <thead><tr className="border-b">{["Product as recorded", "Last logged", "Logged amount", "Recorded instructions", "Source"].map(h => <th key={h} scope="col" className="px-2 py-2 align-top font-medium">{h}</th>)}</tr></thead>
    <tbody>{rows.map(m => <tr key={m.name} className="border-b break-inside-avoid">
      <th scope="row" className="px-2 py-3 align-top font-medium leading-5">{m.name}</th>
      <td className="px-2 py-3 align-top leading-5">{m.lastLoggedAt ? <><span className="whitespace-nowrap">{m.lastLoggedAt.slice(0, 10)}</span><br />{m.lastLoggedAt.slice(11, 16)}</> : "No timed log"}</td>
      <td className="px-2 py-3 align-top leading-5">{m.amount ? `${m.amount}${m.unit ? ` ${m.unit}` : " (unit not recorded)"}` : "Not recorded"}</td>
      <td className="max-w-xs px-2 py-3 align-top leading-5 text-muted-foreground">{m.instructions || "Not specified in list entry"}</td>
      <td className="px-2 py-3 align-top leading-5"><a href={`/api/diagnostic/sources/${sourceId}`} target="_blank" rel="noreferrer" className="underline">{sourceId} records {m.records.join(", ")}</a></td>
    </tr>)}</tbody>
  </table></div>;
}

export function DiagnosticMedications({ medications }: { medications: MedicationReview }) {
  return <section id="medications" className="mt-9 scroll-mt-20 border-t pt-6">
    <h2 className="font-serif-display text-2xl">Guava medication and supplement record</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{medications.note}</p>
    <h3 className="mt-5 text-sm font-semibold">Recent logs through {medications.asOf}</h3>
    <MedicationTable rows={medications.recent} sourceId={medications.sourceId} />
    <details className="mt-5 rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Earlier logs and list-only entries ({medications.earlier.length})</summary>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">These are retained for reconciliation. No recent log does not establish that a product was stopped; a prescription-list entry does not establish that it is being taken.</p>
      <MedicationTable rows={medications.earlier} sourceId={medications.sourceId} />
    </details>
  </section>;
}
