import {writeFileSync} from 'node:fs';
import {fixture} from './fixtures.mjs';
const search=process.argv[2]==='search';
const path=search?'/search?n=1024&d=128&q=1&k=10':'/image?w=256&h=256';
const {bytes}=fixture(path);
const r=await fetch(`http://127.0.0.1:8787${path}`,{method:'POST',body:bytes});
if(!r.ok)throw new Error(await r.text());
const b=Buffer.from(await r.arrayBuffer());
if(search) console.log(Array.from({length:10},(_,i)=>({id:b.readUInt32LE(i*8),score:b.readInt32LE(i*8+4)})));
else {writeFileSync('build/input.pgm',Buffer.concat([Buffer.from('P5\n256 256\n255\n'),bytes]));writeFileSync('build/edges.pgm',Buffer.concat([Buffer.from('P5\n256 256\n255\n'),b]));console.log('Wrote build/input.pgm and build/edges.pgm');}
