import {mkdirSync,writeFileSync} from 'node:fs';
export const variants = ['js-baseline','js-scalar','js-optimized','js-linear','js-fast','js-unrolled','js-specialized','js-chunked','rust-baseline','rust-scalar','rust-simd','rust-small','rust-simd-o3','rust-simd-oz','rust-manual','rust-manual-o3','rust-unroll','rust-unroll-o3','rust-chunked'];
mkdirSync('build',{recursive:true});
for (const variant of variants) {
  const rust=variant.startsWith('rust-');
  const chunked=variant.endsWith('-chunked');
  const mode=chunked ? (rust ? 'manual' : 'optimized') : variant.slice(variant.indexOf('-')+1);
  const wasm=mode==='baseline' ? 'scalar' : mode;
  const modules=[['main',rust?'rust-worker.js':'worker.js'],['js/http.js','http.js'],
    ...(rust ? [['js/wasm-kernels.js','wasm-kernels.js']] : [['js/kernels.js','kernels.js'],['js/dot-generated.js','dot-generated.js'],['js/image-linear.js','image-linear.js']])];
  // Imports resolve relative to the entry module name.
  modules[0][0]=`js/${rust?'rust-worker':'worker'}.js`;
  if(mode==='fast') modules.splice(0,modules.length,['js/fast-worker.js','fast-worker.js'],['js/http.js','http.js'],['js/kernels-fast.js','kernels-fast.js']);
  writeFileSync(`build/${variant}.capnp`, `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name = "app", worker = (
  compatibilityDate = "2026-10-21",
  modules = [${modules.map(([name,file])=>`(name = "${name}", esModule = embed "../js/${file}")`).join(',')}${rust?`,(name = "js/compute.wasm", wasm = embed "${wasm}.wasm")`:''}],
  bindings = [(name = "VARIANT", text = "${mode}"), (name = "READER", text = "${chunked?'chunked':'byob'}"), (name = "ORIGIN", service = "origin")]
 )), (name = "origin", external = (address = "127.0.0.1:8790", http = ()))],
 sockets = [(name = "http", address = "127.0.0.1:8787", http = (), service = "app")]
);
`);
}
