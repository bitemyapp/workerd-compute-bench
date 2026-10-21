import {spec} from '../js/http.js';
export function fixture(path, seed=42) {
  const s=spec(`http://local${path}`), bytes=new Uint8Array(s.bytes);
  let state=seed>>>0;
  function next() { state^=state<<13; state^=state>>>17; state^=state<<5; return state>>>0; }
  if (s.kind==='image') {
    // Structured gray image: gradients, tile edges, and sensor noise.
    const [w,h]=s.args;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++)
      bytes[y*w+x]=Math.max(0,Math.min(255,40+((x*120/w)|0)+((y*50/h)|0)+(((x>>5)^(y>>5))&1)*30+(next()%17)-8));
  } else {
    for(let i=0;i<bytes.length;i++) bytes[i]=next()&255;
  }
  return {s,bytes};
}
export const cases = [
  {name:'image-256',path:'/image?w=256&h=256'},
  {name:'image-1024',path:'/image?w=1024&h=1024'},
  {name:'search-small',path:'/search?n=1024&d=128&q=4&k=10'},
  {name:'search-large',path:'/search?n=32768&d=128&q=8&k=10'},
  {name:'image-io',path:'/image?w=512&h=512&source=origin'},
];
