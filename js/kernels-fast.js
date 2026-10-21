// Production kernels kept separate from experimental branches so V8 sees small,
// monomorphic hot functions. All arithmetic is exact within signed 32-bit range.
export function createFastKernels() {
  let scratch=new Uint16Array(0),blur=new Uint8Array(0);
  function image(a,w,h) {
    const n=w*h;
    if(scratch.length<n){scratch=new Uint16Array(n);blur=new Uint8Array(n);}
    const t=scratch,b=blur,out=new Uint8Array(n),w2=2*w;
    for(let y=0;y<h;y++) {
      const end=(y+1)*w-2;
      for(let p=y*w+2;p<end;p++)t[p]=a[p-2]+4*a[p-1]+6*a[p]+4*a[p+1]+a[p+2];
    }
    for(let y=2;y<h-2;y++) {
      const end=(y+1)*w-2;
      for(let p=y*w+2;p<end;p++)b[p]=(t[p-w2]+4*t[p-w]+6*t[p]+4*t[p+w]+t[p+w2]+128)>>>8;
    }
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
  function search(bytes,n,d,q,k) {
    const a=new Int8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const out=new Uint8Array(q*k*8),dv=new DataView(out.buffer);
    const ids=new Int32Array(k),scores=new Int32Array(k);
    for(let qi=0;qi<q;qi++) {
      scores.fill(-2147483648);
      const query=(n+qi)*d;
      for(let i=0;i<n;i++) {
        const base=i*d;
        let s0=0,s1=0,s2=0,s3=0;
        for(let j=0;j<d;j+=4) {
          s0+=a[base+j]*a[query+j];s1+=a[base+j+1]*a[query+j+1];
          s2+=a[base+j+2]*a[query+j+2];s3+=a[base+j+3]*a[query+j+3];
        }
        const score=s0+s1+s2+s3;
        if(score>scores[k-1]) {
          let j=k-1;
          while(j>0&&score>scores[j-1]){scores[j]=scores[j-1];ids[j]=ids[j-1];j--;}
          scores[j]=score;ids[j]=i;
        }
      }
      for(let j=0;j<k;j++){const p=(qi*k+j)*8;dv.setUint32(p,ids[j],true);dv.setInt32(p+4,scores[j],true);}
    }
    return out;
  }
  return {image,search,memoryBytes:()=>scratch.byteLength+blur.byteLength};
}
