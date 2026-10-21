import {mkdirSync,writeFileSync} from 'node:fs';
mkdirSync('build/io',{recursive:true});
for(const variant of ['js-io','rust-io']) {
  const entry=variant==='js-io'?'js-worker':'rust-worker';
  writeFileSync(`build/${variant}.capnp`,`using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name = "app", worker = (
  compatibilityDate = "2026-10-21",
  modules = [(name = "io/js/${entry}.js", esModule = embed "../io/js/${entry}.js"),
   (name = "io/js/common.js", esModule = embed "../io/js/common.js")${variant==='rust-io'?`,
   (name = "io/pkg/io_wasm.js", esModule = embed "io/pkg/io_wasm.js"),
   (name = "io/pkg/io_wasm_bg.wasm", wasm = embed "io/pkg/io_wasm_bg.wasm")`:''}],
  bindings = [(name = "ORIGIN", service = "origin")]
 )), (name = "origin", external = (address = "127.0.0.1:8790", http = ()))],
 sockets = [(name = "http", address = "127.0.0.1:8787", http = (), service = "app")]
);
`);
}
