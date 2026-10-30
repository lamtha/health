"""Download public reference assembly metadata only; no local read contents used."""
from bile_sulphur_config import ROOT, CONFIG
import json, urllib.request, time
from pathlib import Path

out = Path("analysis/bile_sulphur/references")
for taxid in [35832, 818, 817, 28116, 820, 47678, 876]:
    p = out / f"ncbi_taxon_{taxid}.json"
    if not p.exists():
        url = f"https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/{taxid}/dataset_report?page_size=1000&filters.assembly_source=refseq"
        with urllib.request.urlopen(url, timeout=120) as response:
            p.write_bytes(response.read())
        time.sleep(0.4)
    d = json.loads(p.read_text())
    print(
        taxid,
        "total",
        d.get("total_count"),
        "returned",
        len(d.get("reports", [])),
        "next",
        bool(d.get("next_page_token")),
    )
    if d.get("reports"):
        print(d["reports"][0]["organism"]["organism_name"])
