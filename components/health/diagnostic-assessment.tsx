import type { DiagnosticReview } from "@/lib/diagnostic-review";

export function DiagnosticAssessment({ assessment, references, questions }: {
  assessment: NonNullable<DiagnosticReview["assessment"]>;
  references: DiagnosticReview["references"];
  questions: DiagnosticReview["questions"];
}) {
  const guidance = new Map(references.map(r => [r.url, r]));
  const interview = new Map(questions.map(q => [q.id, q]));
  const factLinks = (ids: string[]) => <p className="mt-3 flex flex-wrap gap-3 text-xs">{ids.map(id => <a key={id} href={`#${id}`} className="underline underline-offset-2">{id}</a>)}</p>;
  return <section id="assessment" className="mt-8 scroll-mt-20 border-t pt-7">
    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Working interpretation · {assessment.asOf}</p>
    <h2 className="mt-2 font-serif-display text-2xl">Leading explanations and next decisions</h2>
    <p className="mt-3 text-sm leading-6">{assessment.summary}</p>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">{assessment.uncertainty}</p>
    <section id="plan" className="mt-6 scroll-mt-20 rounded-lg border bg-card p-5">
      <h3 className="font-semibold">Plan from testing to treatment</h3>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6">{assessment.nextSteps.map(step => <li key={step}>{step}</li>)}</ol>
    </section>
    <div className="mt-5 space-y-4">{assessment.explanations.map((item, i) => <article key={item.id} className="rounded-lg border p-5">
      <h3 className="font-semibold">{i + 1}. {item.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{item.level}</p>
      <dl className="mt-4 grid gap-4 text-sm leading-6 md:grid-cols-2">
        <div><dt className="font-medium">What supports it</dt><dd className="mt-1">{item.support}</dd></div>
        <div><dt className="font-medium">What remains uncertain</dt><dd className="mt-1">{item.limits}</dd></div>
        <div className="md:col-span-2"><dt className="font-medium">What would help distinguish it</dt><dd className="mt-1">{item.nextStep}</dd></div>
      </dl>
      {factLinks(item.factIds)}
    </article>)}</div>
    <h3 className="mt-7 font-semibold">Other considerations and exclusions</h3>
    <div className="mt-3 divide-y">{assessment.otherConsiderations.map(item => <article key={item.title} className="py-4 break-inside-avoid"><h4 className="text-sm font-medium">{item.title}</h4><p className="mt-2 text-sm leading-6">{item.detail}</p>{factLinks(item.factIds)}</article>)}</div>
    {assessment.questionIds.length > 0 && <>
    <h3 className="mt-6 font-semibold">Next interview questions</h3>
    <ul className="mt-3 space-y-3 text-sm leading-6">{assessment.questionIds.map(id => <li key={id}><a href={`#${id}`} className="underline underline-offset-2">{id} · {interview.get(id)?.question}</a></li>)}</ul>
    </>}
    <p className="mt-6 text-xs font-medium">Clinical guidance supporting this framework</p>
    <ul className="mt-2 space-y-2 text-xs">{assessment.referenceUrls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="underline">{guidance.get(url)?.title}</a></li>)}</ul>
  </section>;
}
