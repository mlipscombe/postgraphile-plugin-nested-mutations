const debugFactory = require('debug');

const debug = debugFactory('postgraphile-plugin-nested-mutations');

module.exports = function PostGraphileNestedMutationPlugin(builder) {
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      inflection,
      pgGetGqlInputTypeByTypeIdAndModifier: getGqlInputTypeByTypeIdAndModifier,
      pgNestedPluginForwardInputTypes,
      pgNestedPluginReverseInputTypes,
    } = build;

    const {
      scope: { isInputType, isPgRowType, isPgPatch, pgIntrospection: table },
    } = context;

    const nestedFields = {};

    if (
      (!isPgPatch && (!isInputType || !isPgRowType)) ||
      (!pgNestedPluginForwardInputTypes[table.id] &&
        !pgNestedPluginReverseInputTypes[table.id])
    ) {
      return fields;
    }

    pgNestedPluginForwardInputTypes[table.id].forEach(
      ({ name, keys, connectorInputField }) => {
        // Allow nulls on keys that have forward mutations available.
        keys.forEach((k) => {
          const keyFieldName = inflection.column(k);
          nestedFields[keyFieldName] = Object.assign({}, fields[keyFieldName], {
            type: getGqlInputTypeByTypeIdAndModifier(k.typeId, k.typeModifier),
          });
        });

        nestedFields[name] = Object.assign({}, fields[name], {
          type: connectorInputField,
        });
      },
    );

    pgNestedPluginReverseInputTypes[table.id].forEach(
      ({ name, connectorInputField }) => {
        nestedFields[name] = Object.assign({}, fields[name], {
          type: connectorInputField,
        });
      },
    );

    return Object.assign({}, fields, nestedFields);
  });

  builder.hook('GraphQLObjectType:fields:field', (field, build, context) => {
    const {
      inflection,
      nodeIdFieldName,
      pgSql: sql,
      pgOmit: omit,
      gql2pg,
      parseResolveInfo,
      getTypeByName,
      getTypeAndIdentifiersFromNodeId,
      pgColumnFilter,
      pgQueryFromResolveData: queryFromResolveData,
      pgNestedPluginForwardInputTypes,
      pgNestedPluginReverseInputTypes,
      pgNestedResolvers,
      pgNestedTableConnectorFields,
      pgNestedTableConnect,
      pgNestedTableDeleterFields,
      pgNestedTableDelete,
      pgNestedTableUpdaterFields,
      pgNestedTableUpdate,
      pgViaTemporaryTable: viaTemporaryTable,
      pgGetGqlTypeByTypeIdAndModifier,
    } = build;

    const {
      scope: {
        isPgCreateMutationField,
        isPgUpdateMutationField,
        isPgNodeMutation,
        pgFieldIntrospection: table,
        pgFieldConstraint,
      },
      addArgDataGenerator,
      getDataFromParsedResolveInfoFragment,
    } = context;

    if (!isPgCreateMutationField && !isPgUpdateMutationField) {
      return field;
    }

    if (
      !pgNestedPluginForwardInputTypes[table.id] &&
      !pgNestedPluginReverseInputTypes[table.id]
    ) {
      pgNestedResolvers[table.id] = field.resolve;
      return field;
    }

    const TableType = pgGetGqlTypeByTypeIdAndModifier(table.type.id, null);

    // Ensure the table's primary keys are always available in a query.
    const tablePrimaryKey = table.constraints.find((con) => con.type === 'p');
    if (tablePrimaryKey) {
      addArgDataGenerator(() => ({
        pgQuery: (queryBuilder) => {
          tablePrimaryKey.keyAttributes.forEach((key) => {
            queryBuilder.select(
              sql.fragment`${queryBuilder.getTableAlias()}.${sql.identifier(
                key.name,
              )}`,
              `__pk__${key.name}`,
            );
          });
        },
      }));
    }

    const recurseForwardNestedMutations = async (
      data,
      { input },
      { pgClient },
      resolveInfo,
    ) => {
      const nestedFields = pgNestedPluginForwardInputTypes[table.id];
      const output = Object.assign({}, input);
      await Promise.all(
        nestedFields
          .filter((k) => input[k.name])
          .map(async (nestedField) => {
            const {
              constraint,
              foreignTable,
              keys,
              foreignKeys,
              name: fieldName,
            } = nestedField;
            const fieldValue = input[fieldName];

            await Promise.all(
              pgNestedTableConnectorFields[foreignTable.id]
                .filter((f) => fieldValue[f.fieldName])
                .map(async (connectorField) => {
                  const row = await pgNestedTableConnect({
                    nestedField,
                    connectorField,
                    input: fieldValue[connectorField.fieldName],
                    pgClient,
                  });

                  if (!row) {
                    throw new Error('invalid connect keys');
                  }

                  foreignKeys.forEach((k, idx) => {
                    output[inflection.column(keys[idx])] = row[k.name];
                  });
                }),
            );

            await Promise.all(
              pgNestedTableDeleterFields[foreignTable.id]
                .filter((f) => fieldValue[f.fieldName])
                .map(async (deleterField) => {
                  const row = await pgNestedTableDelete({
                    nestedField,
                    deleterField,
                    input: fieldValue[deleterField.fieldName],
                    pgClient,
                  });

                  if (!row) {
                    throw new Error('invalid connect keys');
                  }

                  foreignKeys.forEach((k, idx) => {
                    output[inflection.column(keys[idx])] = row[k.name];
                  });
                }),
            );

            await Promise.all(
              pgNestedTableUpdaterFields[table.id][constraint.id]
                .filter((f) => fieldValue[f.fieldName])
                .map(async (connectorField) => {
                  const row = await pgNestedTableUpdate({
                    nestedField,
                    connectorField,
                    input: fieldValue[connectorField.fieldName],
                    pgClient,
                    context,
                  });

                  if (!row) {
                    throw new Error('unmatched row for update');
                  }

                  foreignKeys.forEach((k, idx) => {
                    output[inflection.column(keys[idx])] = row[k.name];
                  });
                }),
            );

            if (fieldValue.create) {
              const createData = fieldValue.create;
              const resolver = pgNestedResolvers[foreignTable.id];
              const tableVar = inflection.tableFieldName(foreignTable);

              const insertData = Object.assign(
                {},
                createData,
                await recurseForwardNestedMutations(
                  data,
                  { input: { [tableVar]: createData } },
                  { pgClient },
                  resolveInfo,
                ),
              );

              const resolveResult = await resolver(
                data,
                { input: { [tableVar]: insertData } },
                { pgClient },
                resolveInfo,
              );
              foreignKeys.forEach((k, idx) => {
                output[inflection.column(keys[idx])] =
                  resolveResult.data[`__pk__${k.name}`];
              });
            }
          }),
      );

      return output;
    };

    const newResolver = async (data, { input }, { pgClient }, resolveInfo) => {
      const PayloadType = getTypeByName(
        isPgUpdateMutationField
          ? inflection.updatePayloadType(table)
          : inflection.createPayloadType(table),
      );
      const tableFieldName = isPgUpdateMutationField
        ? inflection.patchField(inflection.tableFieldName(table))
        : inflection.tableFieldName(table);
      const parsedResolveInfoFragment = parseResolveInfo(resolveInfo);
      const resolveData = getDataFromParsedResolveInfoFragment(
        parsedResolveInfoFragment,
        PayloadType,
      );
      const insertedRowAlias = sql.identifier(Symbol());
      const query = queryFromResolveData(
        insertedRowAlias,
        insertedRowAlias,
        resolveData,
        {},
      );

      try {
        await pgClient.query('SAVEPOINT graphql_nested_mutation');

        // run forward nested mutations
        const forwardOutput = await recurseForwardNestedMutations(
          data,
          { input: input[tableFieldName] },
          { pgClient },
          resolveInfo,
        );

        const inputData = Object.assign(
          {},
          input[tableFieldName],
          forwardOutput,
        );

        let mutationQuery = null;

        if (isPgCreateMutationField) {
          const sqlColumns = [];
          const sqlValues = [];
          table.attributes
            .filter((attr) => pgColumnFilter(attr, build, context))
            .filter((attr) => !omit(attr, 'create'))
            .forEach((attr) => {
              const fieldName = inflection.column(attr);
              const val = inputData[fieldName];
              if (Object.prototype.hasOwnProperty.call(inputData, fieldName)) {
                sqlColumns.push(sql.identifier(attr.name));
                sqlValues.push(gql2pg(val, attr.type, attr.typeModifier));
              }
            });

          /* eslint indent: 0 */
          mutationQuery = sql.query`
            insert into ${sql.identifier(table.namespace.name, table.name)}
              ${
                sqlColumns.length
                  ? sql.fragment`(
                    ${sql.join(sqlColumns, ', ')}
                  ) values(${sql.join(sqlValues, ', ')})`
                  : sql.fragment`default values`
              } returning *`;
        } else if (isPgUpdateMutationField) {
          const sqlColumns = [];
          const sqlValues = [];
          let condition = null;

          if (isPgNodeMutation) {
            const nodeId = input[nodeIdFieldName];
            try {
              const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(
                nodeId,
              );
              const primaryKeys = table.primaryKeyConstraint.keyAttributes;
              if (Type !== TableType) {
                throw new Error('Mismatched type');
              }
              if (identifiers.length !== primaryKeys.length) {
                throw new Error('Invalid ID');
              }
              condition = sql.fragment`(${sql.join(
                table.primaryKeyConstraint.keyAttributes.map(
                  (key, idx) =>
                    sql.fragment`${sql.identifier(key.name)} = ${gql2pg(
                      identifiers[idx],
                      key.type,
                      key.typeModifier,
                    )}`,
                ),
                ') and (',
              )})`;
            } catch (e) {
              debug(e);
              throw e;
            }
          } else {
            const { keyAttributes: keys } = pgFieldConstraint;
            condition = sql.fragment`(${sql.join(
              keys.map(
                (key) =>
                  sql.fragment`${sql.identifier(key.name)} = ${gql2pg(
                    input[inflection.column(key)],
                    key.type,
                    key.typeModifier,
                  )}`,
              ),
              ') and (',
            )})`;
          }
          table.attributes
            .filter((attr) => pgColumnFilter(attr, build, context))
            .filter((attr) => !omit(attr, 'update'))
            .forEach((attr) => {
              const fieldName = inflection.column(attr);
              if (fieldName in inputData) {
                const val = inputData[fieldName];
                sqlColumns.push(sql.identifier(attr.name));
                sqlValues.push(gql2pg(val, attr.type, attr.typeModifier));
              }
            });

          if (sqlColumns.length) {
            mutationQuery = sql.query`
              update ${sql.identifier(
                table.namespace.name,
                table.name,
              )} set ${sql.join(
              sqlColumns.map(
                (col, i) => sql.fragment`${col} = ${sqlValues[i]}`,
              ),
              ', ',
            )}
              where ${condition}
              returning *`;
          } else {
            mutationQuery = sql.query`
              select * from ${sql.identifier(table.namespace.name, table.name)}
              where ${condition}`;
          }
        }

        const { text, values } = sql.compile(mutationQuery);
        const { rows } = await pgClient.query(text, values);
        const row = rows[0];

        await Promise.all(
          Object.keys(inputData).map(async (key) => {
            const nestedField = pgNestedPluginReverseInputTypes[table.id].find(
              (obj) => obj.name === key,
            );
            if (!nestedField || !inputData[key]) {
              return;
            }

            const {
              constraint,
              foreignTable,
              keys, // nested table's keys
              foreignKeys, // main mutation table's keys
              isUnique,
            } = nestedField;
            const modifiedRows = [];

            const fieldValue = inputData[key];
            const { primaryKeyConstraint } = foreignTable;
            const primaryKeys = primaryKeyConstraint
              ? primaryKeyConstraint.keyAttributes
              : null;

            if (isUnique && Object.keys(fieldValue).length > 1) {
              throw new Error(
                'Unique relations may only create or connect a single row.',
              );
            }

            await Promise.all(
              pgNestedTableConnectorFields[foreignTable.id]
                .filter((f) => fieldValue[f.fieldName])
                .map(async (connectorField) => {
                  const connections = Array.isArray(
                    fieldValue[connectorField.fieldName],
                  )
                    ? fieldValue[connectorField.fieldName]
                    : [fieldValue[connectorField.fieldName]];

                  await Promise.all(
                    connections.map(async (k) => {
                      const connectedRow = await pgNestedTableConnect({
                        nestedField,
                        connectorField,
                        input: k,
                        pgClient,
                        parentRow: row,
                      });

                      if (primaryKeys) {
                        const rowKeyValues = {};
                        primaryKeys.forEach((col) => {
                          rowKeyValues[col.name] = connectedRow[col.name];
                        });
                        modifiedRows.push(rowKeyValues);
                      }
                    }),
                  );
                }),
            );

            await Promise.all(
              pgNestedTableDeleterFields[foreignTable.id]
                .filter((f) => fieldValue[f.fieldName])
                .map(async (deleterField) => {
                  const connections = Array.isArray(
                    fieldValue[deleterField.fieldName],
                  )
                    ? fieldValue[deleterField.fieldName]
                    : [fieldValue[deleterField.fieldName]];

                  await Promise.all(
                    connections.map(async (k) => {
                      await pgNestedTableDelete({
                        nestedField,
                        deleterField,
                        input: k,
                        pgClient,
                        parentRow: row,
                      });
                    }),
                  );
                }),
            );

            await Promise.all(
              pgNestedTableUpdaterFields[table.id][constraint.id]
                .filter((f) => fieldValue[f.fieldName])
                .map(async (connectorField) => {
                  const updaterField = Array.isArray(
                    fieldValue[connectorField.fieldName],
                  )
                    ? fieldValue[connectorField.fieldName]
                    : [fieldValue[connectorField.fieldName]];

                  await Promise.all(
                    updaterField.map(async (node) => {
                      const where = sql.fragment`
                    (${sql.join(
                      keys.map(
                        (k, i) =>
                          sql.fragment`${sql.identifier(k.name)} = ${sql.value(
                            row[foreignKeys[i].name],
                          )}`,
                      ),
                      ') and (',
                    )})
                  `;
                      const updatedRow = await pgNestedTableUpdate({
                        nestedField,
                        connectorField,
                        input: node,
                        pgClient,
                        context,
                        where,
                      });

                      if (!updatedRow) {
                        throw new Error('unmatched update');
                      }

                      if (primaryKeys) {
                        const rowKeyValues = {};
                        primaryKeys.forEach((k) => {
                          rowKeyValues[k.name] = updatedRow[k.name];
                        });
                        modifiedRows.push(rowKeyValues);
                      }
                    }),
                  );
                }),
            );

            if (fieldValue.create) {
              await Promise.all(
                fieldValue.create.map(async (rowData) => {
                  const resolver = pgNestedResolvers[foreignTable.id];
                  const tableVar = inflection.tableFieldName(foreignTable);

                  const keyData = {};
                  keys.forEach((k, idx) => {
                    const columnName = inflection.column(k);
                    keyData[columnName] = row[foreignKeys[idx].name];
                  });

                  const { data: reverseRow } = await resolver(
                    data,
                    {
                      input: {
                        [tableVar]: Object.assign({}, rowData, keyData),
                      },
                    },
                    { pgClient },
                    resolveInfo,
                  );

                  const rowKeyValues = {};
                  if (primaryKeys) {
                    primaryKeys.forEach((k) => {
                      rowKeyValues[k.name] = reverseRow[`__pk__${k.name}`];
                    });
                  }
                  modifiedRows.push(rowKeyValues);
                }),
              );
            }
            if (fieldValue.deleteOthers) {
              // istanbul ignore next
              if (!primaryKeys) {
                throw new Error(
                  '`deleteOthers` is not supported on foreign relations with no primary key.',
                );
              }
              const keyCondition = sql.fragment`(${sql.join(
                keys.map(
                  (k, idx) => sql.fragment`
                  ${sql.identifier(k.name)} = ${sql.value(
                    row[foreignKeys[idx].name],
                  )}
                `,
                ),
                ') and (',
              )})`;
              let rowCondition;
              if (modifiedRows.length === 0) {
                rowCondition = sql.fragment``;
              } else {
                rowCondition = sql.fragment` and (
                ${sql.join(
                  modifiedRows.map(
                    (r) =>
                      sql.fragment`${sql.join(
                        Object.keys(r).map(
                          (k) => sql.fragment`
                        ${sql.identifier(k)} <> ${sql.value(r[k])}
                      `,
                        ),
                        ' and ',
                      )}`,
                  ),
                  ') and (',
                )})`;
              }

              const deleteQuery = sql.query`
              delete from ${sql.identifier(
                foreignTable.namespace.name,
                foreignTable.name,
              )}
              where (${keyCondition})${rowCondition}`;
              const {
                text: deleteQueryText,
                values: deleteQueryValues,
              } = sql.compile(deleteQuery);
              await pgClient.query(deleteQueryText, deleteQueryValues);
            }
          }),
        );

        let mutationData = null;

        const primaryKeyConstraint = table.constraints.find(
          (con) => con.type === 'p',
        );
        if (primaryKeyConstraint && row) {
          const primaryKeyFields = primaryKeyConstraint.keyAttributes;

          const where = [];
          primaryKeyFields.forEach((f) => {
            where.push(sql.fragment`
              ${sql.identifier(f.name)} = ${sql.value(row[f.name])}
            `);
          });

          const finalRows = await viaTemporaryTable(
            pgClient,
            sql.identifier(table.namespace.name, table.name),
            sql.query`
              select * from ${sql.identifier(table.namespace.name, table.name)}
              where ${sql.join(where, ' AND ')}
            `,
            insertedRowAlias,
            query,
          );
          mutationData = finalRows[0];
        }

        return {
          clientMutationId: input.clientMutationId,
          data: mutationData,
        };
      } catch (e) {
        debug(e);
        await pgClient.query('ROLLBACK TO SAVEPOINT graphql_nested_mutation');
        throw e;
      } finally {
        await pgClient.query('RELEASE SAVEPOINT graphql_nested_mutation');
      }
    };

    if (isPgCreateMutationField) {
      pgNestedResolvers[table.id] = newResolver;
    }

    return Object.assign({}, field, { resolve: newResolver });
  });
};
