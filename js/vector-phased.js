// Keep the short dot function hot independently of the much longer candidate
// scan, so optimization sees all of its feedback before entering a long scan.
function dot(a,base,query,d) {
  let s0=0,s1=0,s2=0,s3=0;
  for(let j=0;j<d;j+=4) {
    s0+=a[base+j]*a[query+j];s1+=a[base+j+1]*a[query+j+1];
    s2+=a[base+j+2]*a[query+j+2];s3+=a[base+j+3]*a[query+j+3];
  }
  return s0+s1+s2+s3;
}
function insert(scores,ids,k,score,id) {
  let j=k-1;
  while(j>0&&score>scores[j-1]){scores[j]=scores[j-1];ids[j]=ids[j-1];j--;}
  scores[j]=score;ids[j]=id;
}
function scan(a,n,d,query,k,scores,ids) {
  for(let i=0;i<n;i++) {
    const score=dot(a,i*d,query,d);
    if(score>scores[k-1])insert(scores,ids,k,score,i);
  }
}
export function search(bytes,n,d,q,k) {
  const a=new Int8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const out=new Uint8Array(q*k*8),dv=new DataView(out.buffer);
  const ids=new Int32Array(k),scores=new Int32Array(k);
  for(let qi=0;qi<q;qi++) {
    scores.fill(-2147483648);
    scan(a,n,d,(n+qi)*d,k,scores,ids);
    for(let j=0;j<k;j++){const p=(qi*k+j)*8;dv.setUint32(p,ids[j],true);dv.setInt32(p+4,scores[j],true);}
  }
  return out;
}
