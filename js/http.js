export function spec(url) {
  const u = new URL(url);
  function integer(name, fallback, min, max) {
    const s = u.searchParams.get(name), n = s === null ? fallback : Number(s);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid ${name}`);
    return n;
  }
  if (u.pathname === '/image') {
    const w=integer('w',1024,7,2048), h=integer('h',1024,7,2048);
    return { kind:'image', args:[w,h], bytes:w*h };
  }
  if (u.pathname === '/search') {
    const n=integer('n',8192,1,32768), d=integer('d',128,16,256);
    const q=integer('q',8,1,16), k=integer('k',10,1,Math.min(n,100));
    if (d%16 || (n+q)*d > 8*1024*1024) throw new Error('invalid dimensions');
    return { kind:'search', args:[n,d,q,k], bytes:(n+q)*d };
  }
  throw new Error('unknown endpoint');
}

async function readExact(body, size) {
  if (!body) throw new Error('missing body');
  const out = new Uint8Array(size), reader = body.getReader();
  let at=0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      if (at+value.length > size) throw new Error('body too large');
      out.set(value,at); at+=value.length;
    }
    if (at !== size) throw new Error('body length mismatch');
    return out;
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

export function handler(kernels) {
  let active=0, reserved=0;
  return async function fetch(request, env={}) {
    const u = new URL(request.url);
    if (u.pathname === '/health') return Response.json({ok:true, scratchBytes:kernels.memoryBytes()});
    if (u.pathname === '/noop') return new Response('ok');
    let s;
    try { s=spec(request.url); } catch(e) { return new Response(e.message,{status:400}); }
    if (request.method !== 'POST') return new Response('POST required',{status:405});
    // Bound simultaneous request bodies, not just an individual body's length.
    if (active >= 4 || reserved+s.bytes > 24*1024*1024) return new Response('busy',{status:503});
    active++; reserved+=s.bytes;
    try {
      let body=request.body;
      if (u.searchParams.get('source') === 'origin') {
        if (!env.ORIGIN) return new Response('origin binding unavailable',{status:400});
        const r = await env.ORIGIN.fetch(`http://origin${u.pathname}${u.search}`);
        if (!r.ok) return new Response('origin failure',{status:502});
        body=r.body;
      }
      const bytes=await readExact(body,s.bytes);
      // Synchronous compute and owned output: shared scratch never spans an await.
      const output=kernels[s.kind](bytes,...s.args);
      return new Response(output,{headers:{'content-type':'application/octet-stream'}});
    } catch(e) { return new Response(e.message,{status:400}); }
    finally { active--; reserved-=s.bytes; }
  };
}
