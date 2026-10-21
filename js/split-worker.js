import {createSplitKernels} from './kernels-split.js';
import {handler} from './http.js';
const fetch=handler(createSplitKernels());
export default {fetch};
