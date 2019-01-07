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
    nestedUpdatePatchType(options) {
      const {
        table,
        constraint,
      } = options;
      return this.camelCase(`update_${table.name}_by_${constraint.keyAttributes.map(k => k.name).join('_and_')}_patch`);
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

  builder.hook('build', (build) => {
    const {
      extend,
      inflection,
      gql2pg,
      pgSql: sql,
      pgColumnFilter,
      pgOmit: omit,
      getTypeAndIdentifiersFromNodeId,
      pgGetGqlTypeByTypeIdAndModifier,
      nodeIdFieldName,
    } = build;

    return extend(build, {
      pgNestedTableUpdaterFields: {},
      pgNestedTableUpdate: async ({
        nestedField,
        connectorField,
        input,
        pgClient,
        where,
        context,
      }) => {
        const {
          foreignTable,
        } = nestedField;
        const {
          isNodeIdUpdater,
          constraint,
        } = connectorField;

        let keyWhere = '';

        if (isNodeIdUpdater) {
          const nodeId = input[nodeIdFieldName];
          const primaryKeys = foreignTable.primaryKeyConstraint.keyAttributes;
          const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
          const ForeignTableType = pgGetGqlTypeByTypeIdAndModifier(foreignTable.type.id, null);
          if (Type !== ForeignTableType) {
            throw new Error('Mismatched type');
          }
          if (identifiers.length !== primaryKeys.length) {
            throw new Error('Invalid ID');
          }
          keyWhere = sql.fragment`${sql.join(
            primaryKeys.map(
              (key, idx) => sql.fragment`${sql.identifier(
                key.name,
              )} = ${gql2pg(
                identifiers[idx],
                key.type,
                key.typeModifier,
              )}`,
            ),
            ') and (',
          )}`;
        } else {
          const foreignPrimaryKeys = constraint.keyAttributes;
          keyWhere = sql.fragment`${sql.join(
            foreignPrimaryKeys.map(
              k => sql.fragment`
                ${sql.identifier(k.name)} = ${gql2pg(input[inflection.column(k)], k.type, k.typeModifier)}
              `,
            ),
            ') and (',
          )}`;
        }

        const patchField = input[
          inflection.patchField(inflection.tableFieldName(foreignTable))
        ];
        const sqlColumns = [];
        const sqlValues = [];
        foreignTable.attributes.forEach((attr) => {
          if (!pgColumnFilter(attr, build, context)) return;
          if (omit(attr, 'update')) return;

          const colFieldName = inflection.column(attr);
          if (colFieldName in patchField) {
            const val = patchField[colFieldName];
            sqlColumns.push(sql.identifier(attr.name));
            sqlValues.push(gql2pg(val, attr.type, attr.typeModifier));
          }
        });

        if (sqlColumns.length === 0) {
          const selectQuery = sql.query`
            select *
            from ${sql.identifier(foreignTable.namespace.name, foreignTable.name)}
            where ${where ? sql.fragment`(${keyWhere}) and (${where})` : keyWhere}
          `;
          const { text, values } = sql.compile(selectQuery);
          const { rows } = await pgClient.query(text, values);
          return rows[0];
        }

        const updateQuery = sql.query`
          update ${sql.identifier(foreignTable.namespace.name, foreignTable.name)}
          set ${sql.join(sqlColumns.map((col, i) => sql.fragment`${col} = ${sqlValues[i]}`), ', ')}
          where ${where ? sql.fragment`(${keyWhere}) and (${where})` : keyWhere}
          returning *`;

        const { text, values } = sql.compile(updateQuery);
        const { rows } = await pgClient.query(text, values);
        return rows[0];
      },
    });
  });

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
      pgNestedTableUpdaterFields,
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

        pgNestedTableUpdaterFields[table.id] = table.constraints
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

            // XXX: this needs to move to where they are created on the other side.
            const patchType = newWithHooks(
              GraphQLInputObjectType,
              {
                name: inflection.nestedUpdatePatchType({ table, constraint }),
                description: `An object where the defined keys will be set on the \`${tableFieldName}\` being updated.`,
                fields: () => {
                  const omittedFields = constraint.keyAttributes.map(k => inflection.column(k));
                  return Object.keys(TablePatch._fields)
                    .filter(key => !omittedFields.includes(key))
                    .map(k => Object.assign({}, { [k]: TablePatch._fields[k] }))
                    .reduce((res, o) => Object.assign(res, o), {});
                },
              }, {
                isNestedMutationPatchType: true,
                pgInflection: table,
                pgFieldInflection: constraint,
              },
            );

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
                        type: new GraphQLNonNull(patchType),
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
          pgNestedTableUpdaterFields[table.id].push({
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
