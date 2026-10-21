import {createSplitKernels} from './kernels-split.js';
import {search} from './vector-phased.js';
import {handler} from './http.js';
const fetch=handler({...createSplitKernels(),search});
export default {fetch};
