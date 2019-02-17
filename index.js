/* eslint-disable global-require */
module.exports = function PostgraphileNestedMutationsPlugin(builder, options) {
  require('./src/PostgraphileNestedConnectorsPlugin.js')(builder, options);
  require('./src/PostgraphileNestedDeletersPlugin')(builder, options);
  require('./src/PostgraphileNestedUpdatersPlugin')(builder, options);
  require('./src/PostgraphileNestedTypesPlugin')(builder, options);
  require('./src/PostgraphileNestedMutationsPlugin')(builder, options);
};
