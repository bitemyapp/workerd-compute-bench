// Convenience Node adapter for the exact same application. Benchmarks use workerd.
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {createKernels} from '../js/kernels.js';
import {createFastKernels} from '../js/kernels-fast.js';
import {wasmKernels} from '../js/wasm-kernels.js';
import {handler} from '../js/http.js';
const variant=process.env.VARIANT??'js-fast';
const kernels=variant.startsWith('rust-')
  ? wasmKernels(new WebAssembly.Module(readFileSync(`build/${variant.slice(5)==='baseline'?'scalar':variant.slice(5)}.wasm`)),variant==='rust-baseline')
  : variant==='js-fast' ? createFastKernels() : createKernels(variant.slice(3));
const handle=handler(kernels);
createServer(async(req,res)=>{
  try {
    const request=new Request(`http://localhost${req.url}`,{method:req.method,headers:req.headers,
      ...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
    const response=await handle(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  } catch(e) {res.writeHead(500);res.end(e.message);}
}).listen(Number(process.env.PORT??8787),'127.0.0.1',()=>console.log(`${variant} on http://127.0.0.1:${process.env.PORT??8787} (Node adapter)`));
