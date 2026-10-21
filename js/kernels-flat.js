import {search} from './vector-phased.js';

// Separate hot loops avoid repeated OSR/deoptimization at phase transitions in
// the pinned V8 version. Extra values at row seams are never read by Sobel.
function horizontal(a,t,n) {
  for(let p=2;p<n-2;p++)t[p]=a[p-2]+4*a[p-1]+6*a[p]+4*a[p+1]+a[p+2];
}
function vertical(t,b,w,n) {
  const w2=2*w;
  for(let p=w2+2;p<n-w2-2;p++)b[p]=(t[p-w2]+4*t[p-w]+6*t[p]+4*t[p+w]+t[p+w2]+128)>>>8;
}
function sobel(b,out,w,h) {
  const end=w*h-3*w-3;
  for(let p=3*w+3;p<end;p++) {
    const u=p-w,v=p+w;
    const gx=-b[u-1]+b[u+1]-2*b[p-1]+2*b[p+1]-b[v-1]+b[v+1];
    const gy=-b[u-1]-2*b[u]-b[u+1]+b[v-1]+2*b[v]+b[v+1];
    out[p]=Math.min(255,Math.abs(gx)+Math.abs(gy));
  }
}
function clearBorders(out,w,h) {
  for(let y=3;y<h-3;y++) {
    const p=y*w,q=p+w;
    out[p]=0;out[p+1]=0;out[p+2]=0;out[q-3]=0;out[q-2]=0;out[q-1]=0;
  }
}
export function createFlatKernels() {
  let t=new Uint16Array(0),b=new Uint8Array(0);
  function image(a,w,h) {
    const n=w*h;
    if(t.length<n){t=new Uint16Array(n);b=new Uint8Array(n);}
    const out=new Uint8Array(n);
    horizontal(a,t,n);vertical(t,b,w,n);sobel(b,out,w,h);clearBorders(out,w,h);
    return out;
  }
  return {image,search,memoryBytes:()=>t.byteLength+b.byteLength};
}
