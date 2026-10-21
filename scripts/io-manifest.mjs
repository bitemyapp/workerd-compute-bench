import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const hashFile=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
export function verifyBuild(){const m=JSON.parse(readFileSync('build/io/manifest.json'));for(const [p,h]of Object.entries({...m.sources,...m.artifacts}))if(hashFile(p)!==h)throw new Error(`stale I/O build: ${p}; npm run build:io`);return m;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const sources=walk('io').filter(p=>/\.(rs|toml|lock|js)$/.test(p)).concat(['scripts/io-build.sh','scripts/io-config.mjs','rust-toolchain.toml','package-lock.json']);
  const artifacts=['target/io/release/io-native','build/io/pkg/io_wasm.js','build/io/pkg/io_wasm_bg.wasm','build/js-io.capnp','build/rust-io.capnp'];
  writeFileSync('build/io/manifest.json',JSON.stringify({sources:Object.fromEntries(sources.map(p=>[p,hashFile(p)])),artifacts:Object.fromEntries(artifacts.map(p=>[p,hashFile(p)]))},null,2)+'\n');
}
