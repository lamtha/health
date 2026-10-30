#!/usr/bin/env python3
"""Plot aggregate depth on public reference coordinates; no read-level exports."""
import collections,csv,os
from pathlib import Path
from workspace_config import ROOT, SAMPLE
os.environ.setdefault('MPLCONFIGDIR',str(ROOT/'analysis/cache/matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
OUT=ROOT/'results';FIG=OUT/'figures';FIG.mkdir(exist_ok=True)
hits={r['protein_accession']:r for r in csv.DictReader((OUT/'gene_hits.tsv').open(),delimiter='\t')}
bins=collections.defaultdict(list)
for r in csv.DictReader((OUT/'target_coverage_bins.tsv').open(),delimiter='\t'):
    bins[r['mapping_reference_id']].append(r)
groups=[('bilophila_reference_coverage','Bilophila bile–taurine–sulfide reference coverage',[
    ('WP_005025869.1','BwBSH1'),('WP_016360761.1','BwBSH2'),('WP_005028753.1','tpa'),
    ('WP_005028754.1','sarD'),('WP_005024906.1','islA'),('WP_005024905.1','islB'),
    ('AAK31309.2','dsrA'),('AAK31310.1','dsrB')]),
    ('mucin_reference_coverage','Selected mucin-enzyme reference coverage',[
    ('EDN75850.1','R. gnavus GH29 / RUMGNA_03833'),('EDN78794.1','R. gnavus GH95 / RUMGNA_00842'),
    ('EDN77080.1','R. gnavus sialidase / RgNanH'),('AAO76743.1','B. thetaiotaomicron sulfatase / BT1636')])]
for name,title,targets in groups:
    fig,axes=plt.subplots(len(targets),1,figsize=(11,1.35*len(targets)+1.8),sharex=True)
    axes=list(axes)
    for ax,(accession,label) in zip(axes,targets):
        h=hits[accession];data=bins[h['mapping_reference_id']]
        length=int(h['reference_nt_length'])
        x=[100*(int(r['start_1based'])-1)/length for r in data]+[100]
        y=[float(r['mean_accepted_read_depth']) for r in data]
        ax.stairs(y,x,fill=True,color='#267e8b',alpha=.8)
        ax.set_ylim(0,max(1,max(y)*1.15));ax.set_xlim(0,100)
        ax.set_ylabel('Depth (×)',fontsize=8)
        ax.set_title(label+'  ·  '+accession,loc='left',fontsize=10,pad=4)
        ax.text(.995,.86,f"{float(h['breadth_1x_pct']):.1f}% of bases covered; {h['unique_mapped_fragments']} fragments",
            transform=ax.transAxes,ha='right',va='top',fontsize=9,
            bbox=dict(facecolor='white',alpha=.85,edgecolor='none',pad=2))
        ax.spines[['top','right']].set_visible(False);ax.grid(axis='y',alpha=.16)
        ax.tick_params(labelsize=8)
    axes[-1].set_xlabel('Position along the public nucleotide reference (%)',fontsize=10)
    fig.suptitle(title+'\n'+SAMPLE,fontsize=14,y=.995)
    fig.text(.08,.015,'Mean accepted-read depth in 50-nt bins; overlapping mates count separately.\n'
        'Reference species labels do not establish the sample carrier. Coverage does not prove an intact gene or pathway activity.',fontsize=9)
    fig.tight_layout(rect=(0,.055,1,.96),h_pad=.8)
    fig.savefig(FIG/(name+'.png'),dpi=180)
    fig.savefig(FIG/(name+'.pdf'))
    plt.close(fig)
print('Wrote two reference coverage figures (PNG and PDF).')
