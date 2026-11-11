"""Reproduce the original map layout with the repaired evaluator; restore sources even on failure."""
from pathlib import Path
import subprocess, os
root=Path(__file__).resolve().parents[2]
paths=[root/'spikes/editor/src'/n for n in ['main.ts','scene.ts','document.ts','query-document.ts','style.css','engine.ts','fallback.ts']]
saved={p:p.read_bytes() for p in paths}
try:
 for p in paths:
  p.write_bytes(subprocess.check_output(['git','show','HEAD:'+str(p.relative_to(root))],cwd=root))
 subprocess.run(['npm','run','build'],cwd=root/'spikes/editor',check=True,stdout=subprocess.DEVNULL)
 subprocess.run(['node','study-02-browser.mjs'],cwd=root/'spikes/editor',env={**os.environ,'ROUND':'before','ONLY':'switch-angel'},check=True)
finally:
 for p,data in saved.items():p.write_bytes(data)
 subprocess.run(['npm','run','build'],cwd=root/'spikes/editor',check=True,stdout=subprocess.DEVNULL)
