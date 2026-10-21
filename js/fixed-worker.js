import {createFastKernels} from './kernels-fast.js';
import {handler} from './http.js';
const fetch=handler(createFastKernels(true));
export default {fetch};
