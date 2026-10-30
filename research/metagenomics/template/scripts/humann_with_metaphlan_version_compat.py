#!/usr/bin/env python3
"""Run HUMAnN 3.9 with MetaPhlAn 4.2's actual first version-output line.

MetaPhlAn 4.2 adds database information after its version line. HUMAnN 3.9
expects that version on the last line. Change only that parser line index in
memory; retain normal prescreen-based pangenome selection and all algorithms.
No installed source, version string or taxonomic profile is rewritten.
"""
import re,subprocess
from workspace_config import ROOT
from humann import config
from humann.humann import main

if __name__=='__main__':
    output=subprocess.check_output(['metaphlan','--version'],stderr=subprocess.STDOUT,text=True)
    first=output.splitlines()[0]
    if not re.match(r'^MetaPhlAn version 4\.2\.5(?:\s|$)',first):
        raise SystemExit('Unexpected MetaPhlAn version output; inspect before changing compatibility behavior')
    config.metaphlan_version=dict(config.metaphlan_version,line=0)
    main()
