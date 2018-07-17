const core = require('./core');

test(
  'prints a schema with the nested mutations plugin',
  core.test(['p'], {
    appendPlugins: [require('../../../index.js')],
  }),
);
