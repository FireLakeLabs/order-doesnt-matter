"""Extract only the owner's fenced programs; preserve every byte inside each block."""
from pathlib import Path
import json, re
root = Path(__file__).parent
attachment = Path('/home/aaron/.t3/userdata/attachments/95b1d8a8-a3ff-4f20-ba1b-2b4a5d92581f-f7dd4961-ecab-4387-9d8f-9e1f57a0ddc5-txt.txt')
blocks = re.findall(rb'(?m)^javascript\r?\n(.*?)^Use code with caution\.\r?$', attachment.read_bytes(), re.S)
names = [('house','House sketch'), ('techno','Techno sketch'), ('trance','Trance sketch'), ('dnb','Drum and Bass sketch'), ('dubstep','Dubstep sketch'), ('ambient','Ambient sketch'), ('future-bass','Future Bass sketch'), ('synthwave','Synthwave sketch'), ('house-arranged','House arrangement'), ('house-vocals','House with vocals'), ('custom-samples','Custom sample usage snippet'), ('dnb-arranged','Drum and Bass arrangement'), ('dubstep-arranged','Dubstep arrangement')]
assert len(blocks) == len(names) == 13
index = json.loads((root/'index.json').read_text())
index = [e for e in index if e['origin'] != 'owner-collected']
for (slug, title), block in zip(names, blocks):
    ident = 'real-' + slug
    (root/'programs'/f'{ident}.strudel').write_bytes(block)
    tags = ['S1']
    if b'stack(' in block or b'arrange(' in block: tags += ['G1','E3']
    if b'const ' in block: tags += ['G3']
    if b'<' in block or b'.slow(' in block or b'arrange(' in block: tags += ['T1']
    if b'.range' in block: tags += ['G4','E1']
    if b'perlin' in block: tags += ['T2']
    if b'.room' in block or b'.delay' in block: tags += ['A2']
    if b'.cut(' in block: tags += ['A3']
    if b'.release(' in block or b'.attack(' in block or b'.clip(' in block: tags += ['A4']
    if b'.slice' in block: tags += ['E4','Q3']
    index.append(dict(id=ident, file=f'programs/{ident}.strudel', title=title, origin='owner-collected', tags=tags, cycles=28 if b'arrange(' in block else 16, kind='usage-snippet' if slug=='custom-samples' else 'composition', notes='Extracted verbatim from owner attachment. Collection is provenance, not a third-party licence grant.' + (' Placeholder URL; not a full piece. External sample loading is stubbed in checks.' if slug=='custom-samples' else '')))
(root/'index.json').write_text(json.dumps(index, indent=2)+'\n')
print(f'Extracted {len(blocks)} byte-identical blocks')
