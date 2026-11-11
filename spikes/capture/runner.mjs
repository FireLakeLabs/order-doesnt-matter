import { Worker } from 'node:worker_threads';
export function run(source, timeoutMs = 20000) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { source }, execArgv: ['--import', new URL('./node-setup.mjs', import.meta.url).href], stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 384 } });
    let done = false;
    const finish = result => { if(done)return; done=true; clearTimeout(timer); worker.terminate(); resolve(result); };
    const timer = setTimeout(()=>finish({fatal:`worker budget exceeded (${timeoutMs}ms)`}),timeoutMs);
    worker.on('message', data=>{if (!data.checkpoint) finish(data);});
    worker.on('error', e=>finish({fatal:String(e)}));
    worker.on('exit', code=>{if(!done)finish({fatal:`worker exited ${code}`});});
  });
}
