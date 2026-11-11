import './style.css';
import {boot,web,evaluate,onNote,snapshotHaps,render,metrics,compare,repl,sampleURLs,liveRender,liveAnalyze,sampleMetadata,alignedComparison} from './engine.js';
window.probe={render,liveRender,liveAnalyze,sampleMetadata,alignedComparison,metrics,compare,sampleURLs};
document.querySelector('#app').innerHTML='<p>Loading real Strudel…</p>';
await boot();
window.probe.ready=true;
const cases=await import('./cases.js');
window.probe.measure=()=>cases.measure({...window.probe,render:async(code,options)=>{
  const frame=document.createElement('iframe');frame.style.display='none';frame.src='/?isolated=1';document.body.append(frame);
  try{await new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(frame.contentWindow?.probe?.ready){clearInterval(timer);resolve();}},10);setTimeout(()=>{clearInterval(timer);reject(Error('isolated frame timeout'));},15000);});return await frame.contentWindow.probe[options?.live?'liveRender':'render'](code,options);}
  finally{await frame.contentWindow?.probe?.close?.();frame.remove();}
}});
window.probe.close=()=>web.getAudioContext().close();
if(!new URLSearchParams(location.search).has('isolated'))await import('./view.js');
