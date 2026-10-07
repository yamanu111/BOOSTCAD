import { readPLN } from './native-pln.mjs?v=0.3.2';
import { completeBrowserModel } from './browser-model.mjs';
self.onmessage = ({ data }) => {
  try {
    const result = completeBrowserModel(readPLN(data, message => self.postMessage({ type: 'progress', message })));
    self.postMessage({ type: 'result', result }, result.objects.flatMap(o => [o.positions.buffer, o.indices.buffer]));
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
