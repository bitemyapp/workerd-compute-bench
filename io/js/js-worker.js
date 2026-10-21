import {worker,shard} from './common.js';
export default worker(async(env,s)=>{
  let next=0,error=false;
  const output=new Uint8Array(8+s.items*12),view=new DataView(output.buffer);
  view.setUint32(0,s.seed,true);view.setUint32(4,s.items,true);
  await Promise.all(Array.from({length:Math.min(s.items,s.parallel)},async()=>{
    while(next<s.items){
      const item=next++;
      try {
        const data=new Uint8Array(await shard(env,s,item));
        let hash=2166136261;
        for(let i=0;i<data.length;i++)hash=Math.imul(hash^data[i],16777619)>>>0;
        const offset=8+item*12;
        view.setUint32(offset,item,true);view.setUint32(offset+4,data.length,true);view.setUint32(offset+8,hash,true);
      }catch{error=true;}
    }
  }));
  if(error)throw new Error('upstream failure');
  return output;
},()=>({}));
