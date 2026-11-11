import net from 'node:net';
import { createServer } from 'vite';
export async function freePort() {
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const address=probe.address();
  if(!address||typeof address==='string')throw Error('No ephemeral port');
  const port=address.port;
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  return port;
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  const server=await createServer({server:{host:'127.0.0.1',port:await freePort(),strictPort:true}});
  await server.listen();server.printUrls();
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close().then(()=>process.exit(0));});
}
