import {createFastKernels} from './kernels-fast.js';
import {handler} from './http.js';
const kernels=createFastKernels();
// Exercise every phase on tiny inputs before a long first request can trigger
// OSR with missing type feedback for later phases. This runs once per isolate;
// no user result is cached and startup measurements include this work.
const pixels=Uint8Array.from({length:49},(_,i)=>(i*73+7)&255);
kernels.image(pixels,7,7);
const vectors=Uint8Array.from({length:10*16},(_,i)=>(i*73+11)&255);
kernels.search(vectors,8,16,2,4);
const fetch=handler(kernels);
export default {fetch};
