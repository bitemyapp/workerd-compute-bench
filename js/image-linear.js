// Flatten the blur passes. Values computed across row seams are never consumed:
// Sobel reads only blur columns 2..w-3, whose horizontal taps stay in their row.
export function imageLinear(input,w,h,temp,blurred) {
  const n=w*h,out=new Uint8Array(n),t=temp,b=blurred;
  for(let p=2;p<n-2;p++)t[p]=input[p-2]+4*input[p-1]+6*input[p]+4*input[p+1]+input[p+2];
  const w2=2*w;
  for(let p=w2+2;p<n-w2-2;p++)b[p]=(t[p-w2]+4*t[p-w]+6*t[p]+4*t[p+w]+t[p+w2]+128)>>>8;
  for(let y=3;y<h-3;y++) {
    const end=(y+1)*w-3;
    for(let p=y*w+3;p<end;p++) {
      const u=p-w,v=p+w;
      const gx=-b[u-1]+b[u+1]-2*b[p-1]+2*b[p+1]-b[v-1]+b[v+1];
      const gy=-b[u-1]-2*b[u]-b[u+1]+b[v-1]+2*b[v]+b[v+1];
      out[p]=Math.min(255,Math.abs(gx)+Math.abs(gy));
    }
  }
  return out;
}
