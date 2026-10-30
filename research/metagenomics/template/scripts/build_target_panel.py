#!/usr/bin/env python3
"""Build a publication-curated nucleotide panel from PUBLIC reference records only.

The only network requests are GET requests for named public reference accessions.
No sample reads, sample-derived sequences, or local identifiers are transmitted.
"""
import csv, gzip, hashlib, io, json, re, time, urllib.parse, urllib.request
from pathlib import Path
from Bio import SeqIO
from Bio.Seq import Seq
from workspace_config import ROOT, SAMPLE
SRC=ROOT/'analysis/references'
OUT=ROOT/'results/references';OUT.mkdir(parents=True,exist_ok=True)
CACHE=SRC/'nucleotide_cds';CACHE.mkdir(exist_ok=True)
rows=[];seqs={};proteins={};requests=[]

def add(target,gene,pathway,substrate,protein,nt,aa,organism,nuc,location,publication,evidence,notes='',uniprot='',role='target',partial=False):
    nt=str(nt).upper();aa=str(aa).rstrip('*')
    trans=str(Seq(nt[:len(nt)//3*3]).translate(table=11)).rstrip('*')
    # Bacterial alternative initiation codons are annotated as initiator Met.
    if len(trans)==len(aa) and trans[1:]==aa[1:] and aa.startswith('M'):trans='M'+trans[1:]
    if not partial and trans!=aa:raise ValueError(f'Translation mismatch {target}: nt={len(nt)} aa={len(aa)}')
    if not partial and ('*' in trans or len(nt)%3):raise ValueError('Invalid complete CDS '+target)
    row=dict(target_id=target,gene=gene,pathway=pathway,substrate=substrate,protein_accession=protein,
             uniprot_accession=uniprot or 'NA',reference_source_organism=organism,nucleotide_accession=nuc,
             cds_location=location,reference_nt_length=len(nt),reference_aa_length=len(aa),
             reference_partial=str(partial).lower(),reference_evidence=evidence,primary_publication=publication,
             reference_role=role,translation_validation='partial_reference' if partial else 'exact_with_initiator_M_rule',
             reference_nt_sha256=hashlib.sha256(nt.encode()).hexdigest(),notes=notes or 'NA')
    rows.append(row);seqs[target]=nt;proteins[target]=aa

def gb_feature(file,protein,gene,pathway,substrate,pub,evidence='primary_experiment',notes='',uid='',role='target',target=None):
    for r in SeqIO.parse(SRC/file,'genbank'):
        for f in r.features:
            if f.type=='CDS' and protein in f.qualifiers.get('protein_id',[]):
                add(target or protein.replace('.','_'),gene,pathway,substrate,protein,f.extract(r.seq),f.qualifiers['translation'][0],
                    r.annotations['organism'],r.id,str(f.location),pub,evidence,notes,uid,role)
                return
    raise ValueError('Protein not in reference '+protein)

def fetch_cds(rec):
    f=next(f for f in rec.features if 'coded_by' in f.qualifiers)
    loc=f.qualifiers['coded_by'][0]
    m=re.fullmatch(r'(complement\()?([A-Za-z0-9_.]+):[<>]?(\d+)\.\.[<>]?(\d+)\)?',loc)
    if not m:raise ValueError('Unsupported coded_by '+loc)
    comp,acc,start,end=m.groups();url='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?'+urllib.parse.urlencode(
        dict(db='nuccore',id=acc,seq_start=start,seq_stop=end,strand=2 if comp else 1,rettype='fasta',retmode='text'))
    cache=CACHE/(rec.id+'.fna')
    if not cache.exists():
        for attempt in range(6):
            try:
                time.sleep(.45);data=urllib.request.urlopen(url,timeout=90).read()
                if not data.startswith(b'>'):raise ValueError('Non-FASTA response')
                cache.write_bytes(data);break
            except Exception:
                if attempt==5:raise
                time.sleep(2**attempt)
    requests.append(dict(protein=rec.id,url=url,sha256=hashlib.sha256(cache.read_bytes()).hexdigest()))
    return SeqIO.read(cache,'fasta').seq,acc,loc,('<'in loc or '>'in loc)

gps={}
for name in ['panel_proteins.gp','panel_corrected_proteins.gp','mucin_selected_proteins.gp','additional_mucin_proteins.gp','reuteri_hdc_proteins.gp','conventional_bsh_proteins.gp']:
    if (SRC/name).exists():gps.update({r.id:r for r in SeqIO.parse(SRC/name,'genbank')})

def gp(protein,gene,pathway,substrate,pub,evidence='primary_experiment',notes='',uid='',target=None):
    r=gps[protein];nt,acc,loc,partial=fetch_cds(r)
    add(target or protein.replace('.','_'),gene,pathway,substrate,protein,nt,r.seq,r.annotations['organism'],acc,loc,pub,evidence,notes,uid,partial=partial)

# The two 2026 metalloBSHs are sequence-defined; generic amidohydrolase annotation is insufficient.
for protein,gene,uid in [('WP_005025869.1','BwBSH1','E5Y4F1'),('WP_016360761.1','BwBSH2','E5Y4F0')]:
    gb_feature('bilophila_BSH_contig.gb',protein,gene,'bile_taurine_release','taurine-conjugated bile acids',
               'https://doi.org/10.64898/2026.04.05.716592',notes='April 2026 preprint; experimentally measured metalloBSH activity; distinct from conventional Ntn-BSH',uid=uid)
    known=json.loads((SRC/(uid+'.json')).read_text())['sequence']['value']
    assert proteins[protein.replace('.','_')]==known,protein
for protein,gene,uid in [('WP_005028753.1','tpa','E5Y945'),('WP_005028754.1','sarD','E5Y946'),('WP_005024906.1','islA','E5Y378'),('WP_005024905.1','islB','E5Y377')]:
    gb_feature('bilophila_BSH_contig.gb',protein,gene,'taurine_to_sulfite','taurine/isethionate',
               'https://doi.org/10.1073/pnas.1815661116',uid=uid)
for protein,gene,uid in [('AAK31309.2','dsrA','Q9AIK4'),('AAK31310.1','dsrB','Q9AIK3')]:
    gb_feature('bilo_dsr_locus.gb',protein,gene,'dissimilatory_sulfite_reduction','sulfite',
               'https://doi.org/10.1128/JB.183.5.1727-1733.2001',uid=uid,
               notes='Experimentally studied RZATAU enzyme; DsrB-D fusion; not the incomplete dsrB annotation in strain 3_1_6')
# Competitive homologs guard against mapping any amidohydrolase as a metalloBSH.
decoys=['WP_005024391.1','WP_005026994.1','WP_016360969.1','WP_016360533.1','WP_016360860.1','WP_016360918.1','WP_016360866.1','WP_005027200.1','WP_005030026.1','WP_009368663.1']
for i,protein in enumerate(decoys,2):
    try:
        gb_feature('bilophila_complete_assembly.gb',protein,f'Bilo_amidohydrolase_H{i}','competitive_control','not_assigned',
                   'https://doi.org/10.64898/2026.04.05.716592',evidence='related_protein_control',role='competitive_decoy',
                   notes='Related amidohydrolase; do not equate homology with strong bile-salt hydrolase activity')
    except ValueError as e:
        if 'Protein not in reference' not in str(e):raise
        print('Decoy unavailable in this contig:',protein)

# Curated sulfur references: distinguish respiratory pathways from side activities.
for args in [
 ('AAA70107.1','dsrA','dissimilatory_sulfite_reduction','sulfite','7887608','P45574'),
 ('AAA70108.1','dsrB','dissimilatory_sulfite_reduction','sulfite','7887608','P45575'),
 ('AAA99275.1','asrA','anaerobic_sulfite_reduction','sulfite','1704886','P26474'),
 ('AAA99276.1','asrB','anaerobic_sulfite_reduction','sulfite','1704886','P26475'),
 ('AAA99277.1','asrC','anaerobic_sulfite_reduction','sulfite','1704886','P0A1Y2'),
 ('AAC36934.1','phsA','thiosulfate_reduction','thiosulfate','7751291','P37600'),
 ('AAC36935.1','phsB','thiosulfate_reduction','thiosulfate','7751291','P0A1I1'),
 ('AAC36936.1','phsC','thiosulfate_reduction','thiosulfate','7751291','P37602'),
 ('AAT48167.1','cyuA/yhaM','cysteine_desulfidation','L-cysteine','27435271','P42626'),
 ('AAC74986.2','dcyD','cysteine_desulfidation','D-cysteine','11527960','P76316'),
 ('AAA24676.1','tnaA','cysteine_secondary_activity','L-cysteine/tryptophan','3902796','P0A853'),
 ('AAC75574.2','sseA','mercaptopyruvate_sulfurtransfer','3-mercaptopyruvate','11445076','P31142'),
 ('AAA24099.1','malY','cysteine_secondary_activity','cystathionine/cysteine','7665481','P23256'),
 ('AAA24158.1','metC','cysteine_secondary_activity','cystathionine/cysteine','8566238','P06721')]:
    protein,gene,path,sub,pmid,uid=args
    gp(protein,gene,path,sub,'https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/',uid=uid,
       notes='Secondary or condition-dependent sulfur activity; presence does not quantify H2S flux' if path in ['cysteine_secondary_activity','mercaptopyruvate_sulfurtransfer'] else '')

# Methanogenesis terminal complex and selected upstream genomic markers.
smithii=SeqIO.read(SRC/'M_smithii_PS.gb','genbank')
for f in smithii.features:
    if f.type!='CDS' or 'protein_id'not in f.qualifiers:continue
    gene=f.qualifiers.get('gene',[''])[0]
    if gene in ['mcrA','mcrB','mcrG','mcrC','mcrD','mtrA','mtrB','mtrC','mtrD','mtrE','mtrF','mtrG','mtrH','hdrA','hdrB','hdrC','mer','mch','fwdF']:
        protein=f.qualifiers['protein_id'][0];target=protein.replace('.','_')+'_'+f.qualifiers.get('locus_tag',['locus'])[0]
        add(target,gene,'hydrogenotrophic_methanogenesis','H2/CO2 or formate',protein,f.extract(smithii.seq),f.qualifiers['translation'][0],
            smithii.annotations['organism'],smithii.id,str(f.location),'https://doi.org/10.1073/pnas.0704189104',
            'primary_genome_pathway_assignment','Genomic marker; not an individual purified-enzyme validation; terminal mcrABG alone is not a complete pathway')

# Additional human-gut methanogens use H2-dependent methylotrophic routes.
for filename,pub in [('M_stadtmanae.gb','https://doi.org/10.1128/JB.188.2.642-658.2006'),
                     ('M_luminyensis.gb','https://pmc.ncbi.nlm.nih.gov/articles/PMC3415480/')]:
    for record in SeqIO.parse(SRC/filename,'genbank'):
        for f in record.features:
            gene=f.qualifiers.get('gene',[''])[0]
            if f.type!='CDS' or 'protein_id'not in f.qualifiers or gene not in ['mcrA','mcrB','mcrG','mcrC','mcrD','mtaA','mtaB','mtaC']:continue
            protein=f.qualifiers['protein_id'][0];target=protein.replace('.','_')+'_'+f.qualifiers.get('locus_tag',['locus'])[0]
            add(target,gene,'hydrogen_dependent_methylotrophic_methanogenesis','H2 plus methanol/methyl compounds',protein,
                f.extract(record.seq),f.qualifiers['translation'][0],record.annotations['organism'],record.id,str(f.location),pub,
                'primary_genome_pathway_assignment','Selected terminal/methanol-entry markers; does not establish a complete methylotrophic pathway or substrate flux')

# Published mucin-active enzymes with explicit locus/accession provenance.
for protein,gene,sub,pub in [
 ('EDN77080.1','RgNanH_RUMGNA_02694','mucin sialic acid','https://doi.org/10.1038/ncomms8624'),
 ('EDN75850.1','RUMGNA_03833_GH29','fucosylated mucin glycans','https://doi.org/10.1007/s00018-020-03514-x'),
 ('EDN78794.1','RUMGNA_00842_GH95','fucosylated mucin glycans','https://doi.org/10.1007/s00018-020-03514-x'),
 ('AAO76743.1','BT1636_3S_Gal_sulfatase','3-sulfated galactose in colonic mucin','https://pmc.ncbi.nlm.nih.gov/articles/PMC9128668/'),
 ('AAO76729.1','BT1622_sulfatase','sulfated mucin glycans','https://pmc.ncbi.nlm.nih.gov/articles/PMC9128668/'),
 ('AAO78163.1','BT3057_sulfatase','sulfated mucin glycans','https://pmc.ncbi.nlm.nih.gov/articles/PMC9128668/'),
 ('AAO78901.1','BT3796_sulfatase','sulfated mucin glycans','https://pmc.ncbi.nlm.nih.gov/articles/PMC9128668/'),
 ('AAO77025.1','BT1918_sulfatase','sulfated mucin glycans','https://pmc.ncbi.nlm.nih.gov/articles/PMC9128668/')]:
    gp(protein,gene,'mucin_glycan_utilization',sub,pub,notes='DNA capacity does not demonstrate mucus barrier injury or pathological activity')

# R. torques VIII-239: exact GSE262875 GFF contains the authors' assembly FASTA.
# These are secretome/transcriptome-supported candidates, not purified-enzyme proofs.
gff=gzip.open(SRC/'torques_VIII239.gff.gz','rt').read();annotation,fasta=gff.split('##FASTA',1)
contigs={r.id:r.seq for r in SeqIO.parse(io.StringIO(fasta.lstrip()),'fasta')}
torques={'00005':'GH95','01008':'GH84','01020':'GH36','01062':'GH2','01159':'GH101','01277':'GH20',
         '01458':'GH29','01463':'GH31','01824':'GH73','01909':'GH20','02237':'GH84','02582':'GH33',
         '02621':'GH101','02639':'GH89','01298':'GH95'}
for line in annotation.splitlines():
    if line.startswith('#'):continue
    c=line.split('\t')
    if len(c)!=9 or c[2]!='CDS':continue
    attrs=dict(x.split('=',1) for x in c[8].split(';') if '='in x);locus=attrs.get('locus_tag','')
    if locus.removeprefix('rumtor8_')not in torques:continue
    nt=contigs[c[0]][int(c[3])-1:int(c[4])]
    if c[6]=='-':nt=nt.reverse_complement()
    aa=str(nt.translate(table=11)).rstrip('*')
    add(locus,locus+'_'+torques[locus.removeprefix('rumtor8_')],'mucin_glycan_utilization','mucin glycans',
        'GSE262875:'+locus,nt,aa,'Mediterraneibacter torques VIII-239','GSE262875:'+c[0],':'.join([c[3],c[4],c[6]]),
        'https://doi.org/10.1128/mbio.00039-24','primary_secretome_transcriptome_candidate',
        'Table S3 candidate; family prediction does not establish substrate specificity; no independent GenBank protein accession supplied')
    if torques[locus.removeprefix('rumtor8_')]=='GH73':
        rows[-1]['pathway']='secretome_candidate_nonmucin_specific'
        rows[-1]['substrate']='glycans; mucin substrate specificity unproven'
        rows[-1]['reference_role']='context_control'
        rows[-1]['notes']='Table S3 candidate. GH73 includes experimentally validated peptidoglycan hydrolases; do not count this homologue as direct mucin-cleavage evidence. Additional context: https://pubmed.ncbi.nlm.nih.gov/26871950/'

for protein,gene,sub,pmid,uid in [
 ('AAB59151.1','hdcA_pyruvoyl','histidine','3021766','P00862'),
 ('BAB80096.1','hdcA_pyruvoyl','histidine','2857718','P0C2E5'),
 ('AAA83526.1','hdcA_pyruvoyl','histidine','2108713','Q0TU55'),
 ('AAA25071.1','hdc_PLP','histidine','2033044','P28578'),
 ('AAA25321.1','hdc_PLP','histidine','3015950','P05034'),
 ('AAA24802.1','hdc_PLP','histidine','2033044','P28577'),
 ('BAB97311.1','hdc_PLP','histidine','12089029','Q8L0Z4')]:
    gp(protein,gene,'histamine_synthesis',sub,'https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/',uid=uid,
       notes='A decarboxylase homologue alone is insufficient without specific sequence evidence; partial reference cannot support a complete-gene claim')
for protein,gene in [('ZP_03961969.1','hdcP'),('ZP_03961970.1','hdcA'),('ZP_03961971.1','hdcB')]:
    gp(protein,gene,'histamine_synthesis_reuteri_module','histidine','https://doi.org/10.1371/journal.pone.0031951',
       evidence='primary_mutagenesis_with_published_reference_accession',
       notes='Paper tests strain 6475 but explicitly cites these MM4-1A reference protein accessions; sequence source is MM4-1A, not evidence of sample strain 6475')
gp('BAA07517.1','histamine_oxidase','histamine_degradation_oxidative','histamine',
   'https://doi.org/10.1074/jbc.270.9.4712',uid='Q59118',notes='Oxygen-dependent activity; cannot infer anaerobic intestinal histamine clearance')
for protein,gene in [('AWA45220.1','hinA'),('AWA45221.1','hinB'),('AWA45222.1','hinC'),('AWA45224.1','hinD'),('AWA45223.1','hinE')]:
    gb_feature('histamine_hin_locus.gb',protein,gene,'histamine_degradation_hin_initial','histamine',
               'https://doi.org/10.1111/1462-2920.14118',evidence='primary_pathway_genetic_validation',
               notes='Initial uptake/regulation/oxidation locus only; full downstream catabolism not covered; HinC/HinD homologs alone are not diagnostic')

# Optional conventional BSHs are curated separately, never used as a proxy for BwBSH1/2.
spec=SRC/'conventional_bsh_specs.json'
if spec.exists():
    for x in json.loads(spec.read_text()):gp(**x)

# Identical nucleotide references cannot be distinguished. Collapse them for mapping.
seen={};aliases=[];canonical=[]
for row in rows:
    target=row['target_id'];key=seqs[target]
    if key in seen:
        row['mapping_reference_id']=seen[key];aliases.append(row)
    else:
        seen[key]=target;row['mapping_reference_id']=target;canonical.append(target)
fields=list(rows[0])
with (OUT/'reference_manifest.tsv').open('w') as f:
    w=csv.DictWriter(f,delimiter='\t',fieldnames=fields);w.writeheader();w.writerows(rows)
with (OUT/'target_panel.fna').open('w') as nt,(OUT/'target_panel.faa').open('w') as aa:
    for target in canonical:
        nt.write('>'+target+'\n'+seqs[target]+'\n');aa.write('>'+target+'\n'+proteins[target]+'\n')
(OUT/'reference_downloads.json').write_text(json.dumps(requests,indent=2)+'\n')
print(f'{len(rows)} reference records; {len(canonical)} distinct nucleotide sequences; {len(aliases)} identical-sequence aliases')
