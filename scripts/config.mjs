import {mkdirSync,writeFileSync} from 'node:fs';
export const variants = ['js-baseline','js-scalar','js-optimized','rust-baseline','rust-scalar','rust-simd','rust-small','rust-simd-o3','rust-simd-oz'];
mkdirSync('build',{recursive:true});
for (const variant of variants) {
  const rust=variant.startsWith('rust-');
  const mode=variant.slice(variant.indexOf('-')+1);
  const wasm=mode==='baseline' ? 'scalar' : mode;
  const modules=[['main',rust?'rust-worker.js':'worker.js'],['js/http.js','http.js'],
    ...(rust ? [['js/wasm-kernels.js','wasm-kernels.js']] : [['js/kernels.js','kernels.js']])];
  // Imports resolve relative to the entry module name.
  modules[0][0]=`js/${rust?'rust-worker':'worker'}.js`;
  writeFileSync(`build/${variant}.capnp`, `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name = "app", worker = (
  compatibilityDate = "2026-10-21",
  compatibilityFlags = ["nodejs_compat"],
  modules = [${modules.map(([name,file])=>`(name = "${name}", esModule = embed "../js/${file}")`).join(',')}${rust?`,(name = "js/compute.wasm", wasm = embed "${wasm}.wasm")`:''}],
  bindings = [(name = "VARIANT", text = "${mode}"), (name = "ORIGIN", service = "origin")]
 )), (name = "origin", external = (address = "127.0.0.1:8790", http = ()))],
 sockets = [(name = "http", address = "127.0.0.1:8787", http = (), service = "app")]
);
`);
}
