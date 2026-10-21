import {createFlatKernels} from './kernels-flat.js';
import {handler} from './http.js';
const fetch=handler(createFlatKernels());
export default {fetch};
