import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sources=['Cargo.toml','Cargo.lock','rust-toolchain.toml','rust/lib.rs','scripts/build.sh'];
export function verifyBuild() {
  const m=JSON.parse(readFileSync('build/manifest.json'));
  for(const [p,sha] of Object.entries({...m.sources,...m.artifacts}))
    if(digest(p)!==sha)throw new Error(`stale or modified build: ${p}; run npm run build`);
  return m;
}
if(import.meta.url===pathToFileURL(process.argv[1]).href) {
  writeFileSync('build/manifest.json',JSON.stringify({
    rustc:execFileSync('rustc',['--version'],{encoding:'utf8'}).trim(),
    sources:Object.fromEntries(sources.map(p=>[p,digest(p)])),
    artifacts:Object.fromEntries(readdirSync('build').filter(f=>f.endsWith('.wasm')).map(f=>[`build/${f}`,digest(`build/${f}`)])),
  },null,2)+'\n');
}
