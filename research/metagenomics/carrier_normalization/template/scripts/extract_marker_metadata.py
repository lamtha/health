"""Extract target marker metadata from the pinned, trusted local MetaPhlAn DB.
Pickle is executable: use only the official database already installed by the
parent pipeline, never a supplied/untrusted pickle. No reads are accessed.
"""
from carrier_config import ROOT, CONFIG
import bz2, hashlib, json, pickle
from pathlib import Path

p = Path("analysis/databases/metaphlan/mpa_vJun23_CHOCOPhlAnSGB_202403.pkl")
sha = hashlib.sha256(p.read_bytes()).hexdigest()
with bz2.open(p, "rb") as f:
    db = pickle.load(f)
sgbs = {"t__SGB4584", "t__SGB4571", "t__SGB4608"}
meta = dict(
    taxonomy={k: v for k, v in db["taxonomy"].items() if k.split("|")[-1] in sgbs},
    markers={k: v for k, v in db["markers"].items() if v["clade"] in sgbs},
)
Path("analysis/carrier_normalization/references").mkdir(parents=True, exist_ok=True)
json.dump(
    meta,
    open(
        "analysis/carrier_normalization/references/metaphlan_target_metadata.json", "w"
    ),
    indent=2,
)
json.dump(
    dict(
        database=p.name,
        sha256=sha,
        source="official MetaPhlAn database installed by parent pipeline",
    ),
    open("results/carrier_normalization/references/metaphlan_database.json", "w"),
    indent=2,
)
