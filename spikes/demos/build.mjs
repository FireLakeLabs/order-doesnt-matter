import {cp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'vite';
const here=import.meta.dirname;
for(const kind of ['gesture','spiral','rooms']){
 const root=resolve(here,'stage',kind);await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
 for(const f of kind==='rooms'?['index.html','main.js','engine.js','view.js','cases.js','programs.js','style.css','public']:['index.html','src',...(kind==='spiral'?['public']:[])])await cp(resolve(here,'..',kind,f),resolve(root,f),{recursive:true});
 await symlink(resolve(here,'node_modules'),resolve(root,'node_modules'),'dir');await cp(resolve(here,'bridge.js'),resolve(root,'demo-bridge.js'));
 let html=await readFile(resolve(root,'index.html'),'utf8');html=html.replace('</body>','<script type="module" src="/demo-bridge.js"></script></body>');await writeFile(resolve(root,'index.html'),html);
 if(kind==='spiral'){
  const pf=resolve(root,'src/programs.ts');await writeFile(pf,(await readFile(pf,'utf8')).replace(/cycles:\d+/g,'cycles:32'));
  const f=resolve(root,'src/main.ts');let s=await readFile(f,'utf8');s=s.replace('const begin=performance.now();scene.animate(cycle);','if(demoClock)cycle=demoClock();const begin=performance.now();scene.animate(cycle);');s=s.replace('function frame(now:number)', 'let demoClock:undefined|(()=>number);Object.assign(window,{demoSpiral:{setClock:(clock:()=>number)=>{demoClock=clock;}}});\nfunction frame(now:number)');await writeFile(f,s);
 }
 if(kind==='gesture'){
  const f=resolve(root,'src/engine.ts');let s=await readFile(f,'utf8');s=s.replace('export type Trigger = {', 'export type Trigger = { value: Record<string, unknown>; end: number;');s=s.replace('revision, loggedAt: performance.now()', 'value: structuredClone(h.value), end: Number(h.whole.end), revision, loggedAt: performance.now()');await writeFile(f,s);
 }
 await build({configFile:false,root,base:`/${kind}/`,build:{outDir:resolve(here,'built',kind),emptyOutDir:true,target:'esnext'},worker:{format:'es'},define:{'process.env.NODE_ENV':'"production"'}});
}
