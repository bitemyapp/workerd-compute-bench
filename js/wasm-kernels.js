export function wasmKernels(module, baseline=false) {
  const e = new WebAssembly.Instance(module,{}).exports;
  const memory = new Uint8Array(e.memory.buffer), input=e.input_ptr(), output=e.output_ptr();
  function run(kind, bytes, args) {
    memory.set(bytes,input);
    const len=e[kind](...args,baseline ? 1 : 0);
    if (!len) throw new Error('invalid kernel arguments');
    // Copy before yielding so later requests cannot overwrite a response in flight.
    return memory.slice(output,output+len);
  }
  return {image:(b,...a)=>run('image',b,a), search:(b,...a)=>run('search',b,a), memoryBytes:()=>memory.byteLength};
}
