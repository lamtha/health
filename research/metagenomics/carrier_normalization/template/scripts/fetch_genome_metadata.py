"""Download public reference assembly metadata only; no local read contents used."""
from carrier_config import ROOT, CONFIG
import json, urllib.request, time
from pathlib import Path

out = Path("analysis/carrier_normalization/references")
for taxid in [33038, 33039, 2316020]:
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
        print(json.dumps(d["reports"][0], indent=2)[:5000])
