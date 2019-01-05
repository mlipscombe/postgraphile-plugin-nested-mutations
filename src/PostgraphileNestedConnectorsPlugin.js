module.exports = function PostGraphileNestedConnectorsPlugin(
  builder,
) {
  builder.hook('inflection', (inflection, build) => build.extend(inflection, {
    nestedConnectByNodeIdField() {
      return this.camelCase(`connect_by_${build.nodeIdFieldName}`);
    },
    nestedConnectByKeyField(options) {
      const {
        constraint,
      } = options;
      return this.camelCase(`connect_by_${constraint.keyAttributes.map(k => k.name).join('_and_')}`);
    },
    nestedUpdateByKeyField(options) {
      const {
        constraint,
      } = options;
      return this.camelCase(`update_by_${constraint.keyAttributes.map(k => k.name).join('_and_')}`);
    },
    nestedConnectByNodeIdInputType(options) {
      const {
        table,
      } = options;

      const tableFieldName = inflection.tableFieldName(table);

      return this.upperCamelCase(`${tableFieldName}_node_id_connect`);
    },
    nestedConnectByKeyInputType(options) {
      const {
        table,
        constraint: {
          name,
          tags: {
            name: tagName,
          },
        },
      } = options;

      const tableFieldName = this.tableFieldName(table);

      return this.upperCamelCase(`${tableFieldName}_${tagName || name}_connect`);
    },
  }));

  builder.hook('build', build => build.extend(build, {
    pgNestedTableConnectors: {},
  }));

  builder.hook('GraphQLObjectType:fields', (fields, build, context) => {
    const {
      inflection,
      newWithHooks,
      describePgEntity,
      nodeIdFieldName,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgGetGqlInputTypeByTypeIdAndModifier: getGqlInputTypeByTypeIdAndModifier,
      pgOmit: omit,
      pgNestedTableConnectors,
      graphql: {
        GraphQLNonNull,
        GraphQLInputObjectType,
        GraphQLID,
      },
    } = build;
    const {
      scope: { isRootMutation },
    } = context;

    if (!isRootMutation) {
      return fields;
    }

    introspectionResultsByKind.class
      .filter(cls => cls.namespace && cls.isSelectable)
      .forEach((table) => {
        const tableFieldName = inflection.tableFieldName(table);

        pgNestedTableConnectors[table.id] = table.constraints
          .filter(con => con.type === 'u' || con.type === 'p')
          .filter(con => !omit(con))
          .filter(con => !con.keyAttributes.some(key => omit(key, 'read')))
          .map((constraint) => {
            const keys = constraint.keyAttributes;
            const connectInputTypeName = inflection.nestedConnectByKeyInputType({ table, constraint });

            // istanbul ignore next
            if (!keys.every(_ => _)) {
              throw new Error(
                `Consistency error: could not find an attribute in the constraint when building nested connection type for ${describePgEntity(
                  table,
                )}!`,
              );
            }

            return {
              constraint,
              keys: constraint.keyAttributes,
              isNodeIdConnector: false,
              fieldName: inflection.nestedConnectByKeyField({ table, constraint }),
              field: newWithHooks(
                GraphQLInputObjectType,
                {
                  name: connectInputTypeName,
                  description: `The fields on \`${tableFieldName}\` to look up the row to connect.`,
                  fields: () => keys
                    .map(k => Object.assign({}, {
                      [inflection.column(k)]: {
                        description: k.description,
                        type: new GraphQLNonNull(getGqlInputTypeByTypeIdAndModifier(k.typeId, k.typeModifier)),
                      },
                    }))
                    .reduce((res, o) => Object.assign(res, o), {}),
                },
                {
                  isNestedMutationInputType: true,
                  isNestedMutationConnectInputType: true,
                  pgInflection: table,
                  pgFieldInflection: constraint,
                },
              ),
            };
          });

        const { primaryKeyConstraint } = table;
        if (nodeIdFieldName && primaryKeyConstraint) {
          const connectInputTypeName = inflection.nestedConnectByNodeIdInputType({ table });
          pgNestedTableConnectors[table.id].push({
            constraint: null,
            keys: null,
            isNodeIdConnector: true,
            fieldName: inflection.nestedConnectByNodeIdField(),
            field: newWithHooks(
              GraphQLInputObjectType,
              {
                name: connectInputTypeName,
                description: 'The globally unique `ID` look up for the row to connect.',
                fields: {
                  [nodeIdFieldName]: {
                    description: `The globally unique \`ID\` which identifies a single \`${tableFieldName}\` to be connected.`,
                    type: new GraphQLNonNull(GraphQLID),
                  },
                },
              },
              {
                isNestedMutationInputType: true,
                isNestedMutationConnectInputType: true,
                isNestedMutationConnectByNodeIdType: true,
                pgInflection: table,
              },
            ),
          });
        }
      });
    return fields;
  });
};
