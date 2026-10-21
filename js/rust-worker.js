import module from './compute.wasm';
import {wasmKernels} from './wasm-kernels.js';
import {handler} from './http.js';
let fetch;
export default { fetch(request,env) {
  fetch ??= handler(wasmKernels(module,env.VARIANT==='baseline'));
  return fetch(request,env);
}};
