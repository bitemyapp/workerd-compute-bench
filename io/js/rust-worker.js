import {worker,shard} from './common.js';
import {aggregate,memory_bytes,initSync} from '../pkg/io_wasm.js';
import module from '../pkg/io_wasm_bg.wasm';
initSync({module});
export default worker((env,s)=>aggregate(item=>shard(env,s,item),s.seed,s.items,s.parallel,s.bytes),()=>({wasmMemoryBytes:memory_bytes()}));
