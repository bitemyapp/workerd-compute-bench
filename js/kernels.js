// Integer math deliberately makes all implementations bit-identical.
import {dot128,dot256} from './dot-generated.js';
import {imageLinear} from './image-linear.js';
const weights = [1, 4, 6, 4, 1];
export function createKernels(variant = 'optimized') {
  let temp = new Uint16Array(0), blurred = new Uint8Array(0);
  function image(input, w, h) {
    const n = w * h;
    if (temp.length < n) { temp = new Uint16Array(n); blurred = new Uint8Array(n); }
    if (variant === 'linear') return imageLinear(input,w,h,temp,blurred);
    blurred.fill(0, 0, n);
    const out = new Uint8Array(n);
    if (variant === 'baseline') {
      for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
        let s = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
          s += input[(y + dy) * w + x + dx] * weights[dy + 2] * weights[dx + 2];
        blurred[y * w + x] = (s + 128) >>> 8;
      }
    } else {
      for (let y = 0; y < h; y++) for (let x = 2; x < w - 2; x++) {
        const p = y * w + x;
        temp[p] = input[p-2] + 4*input[p-1] + 6*input[p] + 4*input[p+1] + input[p+2];
      }
      for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
        const p = y * w + x;
        blurred[p] = (temp[p-2*w] + 4*temp[p-w] + 6*temp[p] + 4*temp[p+w] + temp[p+2*w] + 128) >>> 8;
      }
    }
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
      const p = y*w+x, a = p-w, b = p+w;
      const gx = -blurred[a-1] + blurred[a+1] - 2*blurred[p-1] + 2*blurred[p+1] - blurred[b-1] + blurred[b+1];
      const gy = -blurred[a-1] - 2*blurred[a] - blurred[a+1] + blurred[b-1] + 2*blurred[b] + blurred[b+1];
      out[p] = Math.min(255, Math.abs(gx) + Math.abs(gy));
    }
    return out;
  }
  function search(bytes, n, d, q, k) {
    const a = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Uint8Array(q*k*8), dv = new DataView(out.buffer);
    const ids = new Int32Array(k), scores = new Int32Array(k);
    for (let qi = 0; qi < q; qi++) {
      scores.fill(-2147483648); ids.fill(-1);
      const query = n*d+qi*d;
      const all = variant === 'baseline' ? [] : null;
      for (let i = 0; i < n; i++) {
        const base = i*d;
        let score = 0;
        if (variant === 'specialized' && (d===128 || d===256)) {
          score = d===128 ? dot128(a,base,query) : dot256(a,base,query);
        } else if (variant === 'unrolled') {
          let s0=0,s1=0,s2=0,s3=0;
          for(let j=0;j<d;j+=16) {
            s0+=a[base+j]*a[query+j]+a[base+j+4]*a[query+j+4]+a[base+j+8]*a[query+j+8]+a[base+j+12]*a[query+j+12];
            s1+=a[base+j+1]*a[query+j+1]+a[base+j+5]*a[query+j+5]+a[base+j+9]*a[query+j+9]+a[base+j+13]*a[query+j+13];
            s2+=a[base+j+2]*a[query+j+2]+a[base+j+6]*a[query+j+6]+a[base+j+10]*a[query+j+10]+a[base+j+14]*a[query+j+14];
            s3+=a[base+j+3]*a[query+j+3]+a[base+j+7]*a[query+j+7]+a[base+j+11]*a[query+j+11]+a[base+j+15]*a[query+j+15];
          }
          score=s0+s1+s2+s3;
        } else if (variant === 'baseline' || variant === 'scalar') {
          for (let j = 0; j < d; j++) score += a[base+j] * a[query+j];
        } else {
          let s0=0, s1=0, s2=0, s3=0;
          for (let j = 0; j < d; j+=4) {
            s0 += a[base+j]*a[query+j]; s1 += a[base+j+1]*a[query+j+1];
            s2 += a[base+j+2]*a[query+j+2]; s3 += a[base+j+3]*a[query+j+3];
          }
          score = s0+s1+s2+s3;
        }
        if (all) all.push({id:i, score});
        else if (score > scores[k-1]) {
          let j = k-1;
          while (j > 0 && score > scores[j-1]) { scores[j] = scores[j-1]; ids[j] = ids[j-1]; j--; }
          scores[j] = score; ids[j] = i;
        }
      }
      if (all) {
        all.sort((a,b) => b.score-a.score || a.id-b.id);
        for (let j=0;j<k;j++) { ids[j]=all[j].id; scores[j]=all[j].score; }
      }
      for (let j=0;j<k;j++) { const p=(qi*k+j)*8; dv.setUint32(p,ids[j],true); dv.setInt32(p+4,scores[j],true); }
    }
    return out;
  }
  return { image, search, transfer:(_bytes,n)=>new Uint8Array(n), noop:()=>new TextEncoder().encode('ok'), memoryBytes: () => temp.byteLength + blurred.byteLength };
}
