import Link from "next/link";
import { TopBar } from "@/components/health/top-bar";
import { DiagnosticMedications } from "@/components/health/diagnostic-medications";
import { DiagnosticAssessment } from "@/components/health/diagnostic-assessment";
import { DiagnosticActions } from "@/components/health/diagnostic-actions";
import { readDiagnosticReview } from "@/lib/diagnostic-review";

export const dynamic = "force-dynamic";
export default async function DiagnosticPage() {
  const review = await readDiagnosticReview();
  if (!review) return <><TopBar current="diagnostic" /><main className="mx-auto max-w-4xl p-8"><h1 className="text-3xl">Diagnostic review</h1><p className="mt-4">No review has been saved for this app’s data directory yet.</p></main></>;
  const groups = Array.from(new Set(review.facts.map(f => f.group)));
  const activeQuestions = review.questions.filter(q => q.status !== "planned");
  const plannedQuestions = review.questions.filter(q => q.status === "planned");
  const byId = new Map(review.sources.map(s => [s.id, s]));
  return <div className="min-h-screen">
    <div className="print:hidden"><TopBar current="diagnostic" /></div>
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <header className="border-b pb-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">For clinician review · {review.updatedOn}</p>
        <h1 className="mt-3 font-serif-display text-4xl">{review.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{review.scope}</p>
        <p className="my-4 text-sm font-medium">{review.status}</p>
        <DiagnosticActions />
      </header>
      <nav aria-label="Review sections" className="my-6 flex flex-wrap gap-x-5 gap-y-2 text-sm underline underline-offset-4 print:hidden">
        {review.assessment && <a href="#assessment">Working assessment</a>}<a href="#facts">Facts</a>{review.tracking && <a href="#tracking">Guava coverage</a>}{review.medications && <a href="#medications">Medications</a>}<a href="#interview">Diagnostic interview</a><a href="#gaps">Open questions</a><a href="#uploads">Upload list</a><a href="#sources">Sources</a>
      </nav>
      <div className="grid gap-3 sm:grid-cols-3">
        {[['Reviewed observations',review.facts.length],['Database reports',review.inventory.databaseReports],['New interview answers',review.questions.reduce((n,q)=>n+q.answers.length,0)]].map(([label,value])=><div key={label} className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}
      </div>
      {review.assessment && <DiagnosticAssessment assessment={review.assessment} references={review.references} questions={review.questions} />}
      {review.tracking && <section id="tracking" className="mt-8 scroll-mt-20 rounded-lg border p-5">
        <h2 className="font-serif-display text-2xl">Guava tracking coverage</h2>
        <p className="mt-2 text-sm leading-6">{review.tracking.dataRecords} data records in the export. {review.tracking.timedTrackingRecords} timestamped entries in the five categories below cover {review.tracking.daysWithEntries} days, from {review.tracking.firstDate} to {review.tracking.lastDate}.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Number of logged entries by month and category</caption><thead><tr className="border-b">{['Month','Days logged','Symptoms','Meals','Medication logs','Breath readings'].map(h=><th key={h} scope="col" className="px-2 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{review.tracking.byMonth.map(m=><tr key={m.month} className="border-b"><th scope="row" className="px-2 py-2 font-normal">{m.month}</th><td className="px-2">{m.days}</td><td className="px-2">{m.categories.Symptoms ?? 0}</td><td className="px-2">{m.categories.Food ?? 0}</td><td className="px-2">{m.categories.Medication ?? 0}</td><td className="px-2">{(m.categories['Methane Breath Reading'] ?? 0)+(m.categories['Hydrogen Breath Reading'] ?? 0)}</td></tr>)}</tbody></table></div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{review.tracking.note} <a href={`/api/diagnostic/sources/${review.tracking.sourceId}`} className="underline">Original CSV</a></p>
      </section>}
      {review.medications && <DiagnosticMedications medications={review.medications} />}
      <section id="facts" className="mt-9 scroll-mt-20">
        <h2 className="font-serif-display text-2xl">Facts and their limits</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Measured results, clinical documentation and your current account are labeled separately. An abnormal marker is not automatically a cause. Dates refer to the event or specimen where available.</p>
        {groups.map(group=><div key={group} className="mt-7"><h3 className="border-b pb-2 font-semibold">{group}</h3>
          <ul className="divide-y">{review.facts.filter(f=>f.group===group).map(f=><li id={f.id} key={f.id} className="scroll-mt-20 py-4 break-inside-avoid">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="font-mono">{f.id}</span><span>{f.kind}</span><span>{f.date}</span></div>
            <p className="mt-2 text-sm leading-6">{f.statement}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground">Limit / follow-up: </span>{f.boundary}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">{f.sources.map(s=><a key={s.sourceId} className="underline underline-offset-2" href={`/api/diagnostic/sources/${s.sourceId}${s.pages.length ? `#page=${s.pages[0]}` : ''}`} target="_blank" rel="noreferrer" title={byId.get(s.sourceId)?.title}>{s.sourceId} · {s.pages.length ? `PDF p. ${s.pages.join(', ')}` : s.records.length ? `${byId.get(s.sourceId)?.format === "html" ? "HTML table rows" : "CSV records"} ${s.records.join(', ')}` : 'Tracking aggregate'}</a>)}{f.interviewQuestionIds.map(id=><a key={id} href={`#${id}`} className="underline">Current interview · {id}</a>)}{!f.sources.length && !f.interviewQuestionIds.length && <a href="#interview" className="underline">Current interview</a>}</div>
          </li>)}</ul>
        </div>)}
      </section>
      <section id="interview" className="mt-10 scroll-mt-20 border-t pt-7">
        <h2 className="font-serif-display text-2xl">Diagnostic interview</h2>
        <p className="mt-2 text-sm text-muted-foreground">Answers are captured from this fresh interview. Missing answers remain unknown. Earlier clinic histories do not fill these fields.</p>
        <div className="mt-5 space-y-4">{activeQuestions.map(q=><article id={q.id} key={q.id} className="scroll-mt-20 rounded-lg border p-5 break-inside-avoid">
          <p className="text-xs text-muted-foreground">{q.id} · {q.phase} · {q.status === 'partial' ? 'Partially answered' : q.status === 'answered' ? 'Answered' : 'Awaiting answer'} · Asked {q.askedOn}</p>
          <h3 className="mt-2 text-sm font-medium leading-6">{q.question}</h3>
          {q.answers.map((a,i)=><div key={i} className="mt-4 border-l-2 pl-4"><p className="text-xs text-muted-foreground">{a.source} · {a.recordedOn}</p><blockquote className="mt-2 whitespace-pre-wrap text-sm leading-6">“{a.verbatim}”</blockquote><p className="mt-2 text-xs leading-5 text-muted-foreground">Recorded meaning: {a.summary}</p></div>)}
          {!q.answers.length && <p className="mt-3 text-sm text-muted-foreground">Not yet answered.</p>}
        </article>)}</div>
        <details className="mt-5 rounded-lg border p-5"><summary className="cursor-pointer text-sm font-medium">Planned follow-up questions ({plannedQuestions.length}) · not yet asked</summary><ol className="mt-4 space-y-4">{plannedQuestions.map(q=><li key={q.id} className="text-sm leading-6"><span className="font-medium">{q.id} · {q.phase}: </span>{q.question}</li>)}</ol></details>
      </section>
      <section id="gaps" className="mt-10 scroll-mt-20 border-t pt-7"><h2 className="font-serif-display text-2xl">What remains unresolved</h2><ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6">{review.gaps.map(g=><li key={g}>{g}</li>)}</ul></section>
      <section className="mt-9"><h2 className="font-serif-display text-2xl">How we will investigate</h2><ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6">{review.approach.map(a=><li key={a}>{a}</li>)}</ol><p className="mt-4 text-sm text-muted-foreground">This is a framework for the discussion with your clinician. The working explanations are hypotheses for clinician review; no diagnosis or new treatment is assigned.</p></section>
      <section id="uploads" className="mt-10 scroll-mt-20 border-t pt-7">
        <h2 className="font-serif-display text-2xl">Reports to upload through the app</h2>
        <p className="mt-2 text-sm leading-6">The listed GI-priority PDFs have no exact file-hash match in the database snapshot. <Link className="underline" href="/uploads">Open Upload</Link>.</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">{review.unmatchedReports.filter(r=>r.priority==='GI priority').map(r=><li key={r.path} className="break-words">{r.filename}</li>)}</ul>
        <details className="mt-5 rounded-lg border p-5"><summary className="cursor-pointer text-sm font-medium">All {review.unmatchedReports.length} unmatched PDF candidates</summary><p className="mt-3 text-xs leading-5 text-muted-foreground">No hash match does not prove a new clinical result. This list includes requisitions, summaries and alternative versions; review before uploading.</p><ul className="mt-4 space-y-3">{review.unmatchedReports.map(r=><li key={r.path} className="text-sm break-words"><span className="mr-2 text-xs text-muted-foreground">{r.priority}</span>{r.filename}</li>)}</ul></details>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">Inventory: {review.inventory.archivePdfFiles} archive PDFs ({review.inventory.uniqueArchivePdfs} unique file hashes); {review.inventory.exactMatchedFiles} files matched database reports. {review.inventory.note} No database records were written by this review.</p>
      </section>
      <section className="mt-9"><h2 className="font-serif-display text-2xl">Record quality</h2><div className="mt-4 space-y-4">{review.dataIssues.map(issue=><article key={issue.title} className="rounded-lg border p-4"><h3 className="text-sm font-medium">{issue.title}</h3><p className="mt-2 text-sm leading-6">{issue.detail}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{issue.action}</p></article>)}</div></section>
      <section id="sources" className="mt-10 scroll-mt-20 border-t pt-7"><h2 className="font-serif-display text-2xl">Source documents</h2><ol className="mt-4 space-y-4">{review.sources.map(s=><li key={s.id} className="text-sm leading-6 break-inside-avoid"><a href={`/api/diagnostic/sources/${s.id}`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{s.id} · {s.title}</a><p className="break-words text-xs text-muted-foreground">{s.filename}</p>{s.reportId ? <Link href={`/reports/${s.reportId}`} className="text-xs underline">Database report {s.reportId}</Link> : <span className="text-xs text-muted-foreground">{s.format !== "pdf" ? "Tracking source reviewed separately; no database import" : "Not matched in database; original report linked above"}</span>}</li>)}</ol></section>
      <section className="mt-9 border-t pt-6"><h2 className="text-lg font-semibold">Clinical guidance used for the interview framework</h2><ul className="mt-4 space-y-4 text-sm">{review.references.map(r=><li key={r.url}><a href={r.url} className="underline" target="_blank" rel="noreferrer">{r.title}</a><p className="mt-1 text-muted-foreground">{r.use}</p></li>)}</ul></section>
    </main>
    <style>{`@media print { body { background: white !important; color: black !important; } main { max-width: none !important; padding: 0 !important; } details > * { display: block !important; } details { content-visibility: visible !important; } a { color: black !important; } }`}</style>
  </div>;
}
