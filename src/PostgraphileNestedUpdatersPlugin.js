module.exports = function PostGraphileNestedUpdatersPlugin(
  builder,
) {
  builder.hook('inflection', (inflection, build) => build.extend(inflection, {
    nestedUpdateByNodeIdField() {
      return this.camelCase(`update_by_${build.nodeIdFieldName}`);
    },
    nestedUpdateByKeyField(options) {
      const {
        constraint,
      } = options;
      return this.camelCase(`update_by_${constraint.keyAttributes.map(k => k.name).join('_and_')}`);
    },
    nestedUpdateByNodeIdInputType(options) {
      const {
        table,
      } = options;

      const tableFieldName = inflection.tableFieldName(table);

      return this.upperCamelCase(`${tableFieldName}_node_id_update`);
    },
    nestedUpdateByKeyInputType(options) {
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

      return this.upperCamelCase(`${tableFieldName}_${tagName || name}_update`);
    },
  }));

  builder.hook('build', build => build.extend(build, {
    pgNestedTableUpdaters: {},
  }));

  builder.hook('GraphQLObjectType:fields', (fields, build, context) => {
    const {
      inflection,
      newWithHooks,
      describePgEntity,
      nodeIdFieldName,
      getTypeByName,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgGetGqlInputTypeByTypeIdAndModifier,
      pgGetGqlTypeByTypeIdAndModifier,
      pgOmit: omit,
      pgNestedTableUpdaters,
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
        const TableType = pgGetGqlTypeByTypeIdAndModifier(
          table.type.id,
          null,
        );
        const tableFieldName = inflection.tableFieldName(table);
        const patchFieldName = inflection.patchField(tableFieldName);
        const TablePatch = getTypeByName(
          inflection.patchType(TableType.name),
        );

        pgNestedTableUpdaters[table.id] = table.constraints
          .filter(con => con.type === 'u' || con.type === 'p')
          .filter(con => !omit(con))
          .filter(con => !con.keyAttributes.some(key => omit(key, 'read')))
          .map((constraint) => {
            const keys = constraint.keyAttributes;

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
              isNodeIdUpdater: false,
              fieldName: inflection.nestedUpdateByKeyField({ table, constraint }),
              field: newWithHooks(
                GraphQLInputObjectType,
                {
                  name: inflection.nestedUpdateByKeyInputType({ table, constraint }),
                  description: `The fields on \`${tableFieldName}\` to look up the row to update.`,
                  fields: () => Object.assign(
                    {},
                    {
                      [patchFieldName]: {
                        description: `An object where the defined keys will be set on the \`${tableFieldName}\` being updated.`,
                        type: new GraphQLNonNull(TablePatch),
                      },
                    },
                    keys
                      .map(k => Object.assign({}, {
                        [inflection.column(k)]: {
                          description: k.description,
                          type: new GraphQLNonNull(pgGetGqlInputTypeByTypeIdAndModifier(k.typeId, k.typeModifier)),
                        },
                      }))
                      .reduce((res, o) => Object.assign(res, o), {}),
                  ),
                },
                {
                  isNestedMutationInputType: true,
                  isNestedMutationUpdateInputType: true,
                  pgInflection: table,
                  pgFieldInflection: constraint,
                },
              ),
            };
          });

        const { primaryKeyConstraint } = table;
        if (nodeIdFieldName && primaryKeyConstraint) {
          pgNestedTableUpdaters[table.id].push({
            constraint: null,
            keys: null,
            isNodeIdUpdater: true,
            fieldName: inflection.nestedUpdateByNodeIdField(),
            field: newWithHooks(
              GraphQLInputObjectType,
              {
                name: inflection.nestedUpdateByNodeIdInputType({ table }),
                description: 'The globally unique `ID` look up for the row to update.',
                fields: {
                  [nodeIdFieldName]: {
                    description: `The globally unique \`ID\` which identifies a single \`${tableFieldName}\` to be connected.`,
                    type: new GraphQLNonNull(GraphQLID),
                  },
                  [patchFieldName]: {
                    description: `An object where the defined keys will be set on the \`${tableFieldName}\` being updated.`,
                    type: new GraphQLNonNull(TablePatch),
                  },
                },
              },
              {
                isNestedMutationInputType: true,
                isNestedMutationUpdateInputType: true,
                isNestedMutationUpdateByNodeIdType: true,
                pgInflection: table,
              },
            ),
          });
        }
      });

    return fields;
  });
};
