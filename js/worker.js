import {createKernels} from './kernels.js';
import {handler} from './http.js';
const handlers = new Map();
export default { fetch(request,env) {
  if (!handlers.has(env.VARIANT)) handlers.set(env.VARIANT,handler(createKernels(env.VARIANT)));
  return handlers.get(env.VARIANT)(request,env);
}};
