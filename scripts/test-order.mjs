import assert from 'node:assert/strict';
import {roundOrder} from './order.mjs';
for(const n of [2,4,19]) {
  const input=Array.from({length:n},(_,i)=>i),counts=Array.from({length:n},()=>Array(n).fill(0));
  for(let r=0;r<2*n;r++) {
    const order=roundOrder(input,r);
    assert.deepEqual([...order].sort((a,b)=>a-b),input);
    order.forEach((v,pos)=>counts[v][pos]++);
  }
  assert(counts.flat().every(c=>c===2));
  assert.deepEqual(roundOrder(input,0),[...roundOrder(input,1)].reverse());
}
console.log('Benchmark order: counterbalanced positions for 2, 4 and 19 entrants passed');
