import {createReadStream,createWriteStream,existsSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {createGzip,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
export function readResults(mode) {
  const path=`results/io-${mode}.json`;
  return JSON.parse(existsSync(path)?readFileSync(path):gunzipSync(readFileSync(`${path}.gz`)));
}
export async function archiveResults() {
  const manifests={};
  for(const mode of ['closed','open','origin']) {
    const path=`results/io-${mode}.json`,archive=`${path}.gz`;
    if(!existsSync(path)){if(!existsSync(archive))throw new Error(`Missing ${path} or ${archive}`);continue;}
    const hash=createHash('sha256');
    await pipeline(createReadStream(path),new Transform({transform(chunk,encoding,callback){hash.update(chunk);callback(null,chunk);}}),createGzip({level:6}),createWriteStream(archive));
    manifests[archive]={rawBytes:statSync(path).size,rawSha256:hash.digest('hex'),gzipBytes:statSync(archive).size,gzipSha256:createHash('sha256').update(readFileSync(archive)).digest('hex')};
  }
  if(Object.keys(manifests).length) {
    const old=existsSync('results/io-archives.json')?JSON.parse(readFileSync('results/io-archives.json')):{};
    writeFileSync('results/io-archives.json',JSON.stringify({...old,...manifests},null,2)+'\n');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await archiveResults();console.log('Archived raw I/O results losslessly.');}
