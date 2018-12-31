/* eslint-disable global-require */
const core = require('./core');

test(
  'prints a schema with the nested mutations plugin',
  core.test(['p'], {
    appendPlugins: [require('../../../index.js')],
  }),
);

test(
  'prints a schema with the nested mutations plugin in simple names mode',
  core.test(['p'], {
    graphileBuildOptions: {
      nestedMutationsSimpleFieldNames: true,
    },
    appendPlugins: [require('../../../index.js')],
  }),
);
