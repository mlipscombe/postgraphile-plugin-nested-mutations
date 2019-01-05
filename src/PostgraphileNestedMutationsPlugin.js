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
      scope: {
        isInputType,
        isPgRowType,
        isPgPatch,
        pgIntrospection: table,
      },
    } = context;

    const nestedFields = {};

    if (
      (!isPgPatch && (!isInputType || !isPgRowType))
      || (!pgNestedPluginForwardInputTypes[table.id] && !pgNestedPluginReverseInputTypes[table.id])
    ) {
      return fields;
    }

    pgNestedPluginForwardInputTypes[table.id].forEach(({ name, keys, connectorInputField }) => {
      // Allow nulls on keys that have forward mutations available.
      keys.forEach((k) => {
        const keyFieldName = inflection.column(k);
        nestedFields[keyFieldName] = Object.assign(
          {},
          fields[keyFieldName],
          { type: getGqlInputTypeByTypeIdAndModifier(k.typeId, k.typeModifier) },
        );
      });

      nestedFields[name] = Object.assign(
        {},
        fields[name],
        { type: connectorInputField },
      );
    });

    pgNestedPluginReverseInputTypes[table.id].forEach(({ name, connectorInputField }) => {
      nestedFields[name] = Object.assign(
        {},
        fields[name],
        { type: connectorInputField },
      );
    });

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
      pgNestedTableConnectors,
      pgNestedTableUpdaters,
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

    if (!pgNestedPluginForwardInputTypes[table.id] && !pgNestedPluginReverseInputTypes[table.id]) {
      pgNestedResolvers[table.id] = field.resolve;
      return field;
    }

    const TableType = pgGetGqlTypeByTypeIdAndModifier(table.type.id, null);

    // Ensure the table's primary keys are always available in a query.
    const tablePrimaryKey = table.constraints.find(con => con.type === 'p');
    if (tablePrimaryKey) {
      addArgDataGenerator(() => ({
        pgQuery: (queryBuilder) => {
          tablePrimaryKey.keyAttributes.forEach((key) => {
            queryBuilder.select(
              sql.fragment`${queryBuilder.getTableAlias()}.${sql.identifier(key.name)}`,
              `__pk__${key.name}`,
            );
          });
        },
      }));
    }

    const recurseForwardNestedMutations = async (data, { input }, { pgClient }, resolveInfo) => {
      const nestedFields = pgNestedPluginForwardInputTypes[table.id];
      const output = Object.assign({}, input);
      await Promise.all(nestedFields
        .filter(k => Object.prototype.hasOwnProperty.call(input, k.name))
        .map(async (f) => {
          const {
            foreignTable,
            keys,
            foreignKeys,
            name: fieldName,
          } = f;
          const fieldValue = input[fieldName];
          const ForeignTableType = pgGetGqlTypeByTypeIdAndModifier(foreignTable.type.id, null);

          const foreignTableConnectorFields = pgNestedTableConnectors[foreignTable.id];
          await Promise.all(foreignTableConnectorFields.map(async ({
            fieldName: connectorFieldName,
            isNodeIdConnector,
            constraint,
          }) => {
            if (!(connectorFieldName in fieldValue)) {
              return;
            }

            let where = '';

            if (isNodeIdConnector) {
              const nodeId = fieldValue[connectorFieldName][nodeIdFieldName];
              const primaryKeys = foreignTable.primaryKeyConstraint.keyAttributes;
              const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
              if (Type !== ForeignTableType) {
                throw new Error('Mismatched type');
              }
              if (identifiers.length !== primaryKeys.length) {
                throw new Error('Invalid ID');
              }
              where = sql.fragment`${sql.join(
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
              where = sql.fragment`${sql.join(
                foreignPrimaryKeys.map(
                  k => sql.fragment`
                    ${sql.identifier(k.name)} = ${gql2pg(
                      fieldValue[connectorFieldName][inflection.column(k)],
                      k.type,
                      k.typeModifier,
                    )}
                  `,
                ),
                ') and (',
              )}`;
            }
            const select = foreignKeys.map(k => sql.identifier(k.name));
            const connectQuery = sql.query`
              select ${sql.join(select, ', ')}
              from ${sql.identifier(foreignTable.namespace.name, foreignTable.name)}
              where ${where}
            `;
            const { text, values } = sql.compile(connectQuery);
            const { rows: connectedRows } = await pgClient.query(text, values);
            const connectedRow = connectedRows[0];
            foreignKeys.forEach((k, idx) => {
              output[inflection.column(keys[idx])] = connectedRow[k.name];
            });
          }));

          const foreignTableUpdaterFields = pgNestedTableUpdaters[foreignTable.id];
          await Promise.all(foreignTableUpdaterFields.map(async ({
            fieldName: updaterFieldName,
            isNodeIdUpdater,
            constraint,
          }) => {
            if (!(updaterFieldName in fieldValue)) {
              return;
            }

            let keyWhere = '';

            if (isNodeIdUpdater) {
              const nodeId = fieldValue[updaterFieldName][nodeIdFieldName];
              const primaryKeys = foreignTable.primaryKeyConstraint.keyAttributes;
              const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
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
                    ${sql.identifier(k.name)} = ${gql2pg(
                      fieldValue[updaterFieldName][inflection.column(k)],
                      k.type,
                      k.typeModifier,
                    )}
                  `,
                ),
                ') and (',
              )}`;
            }
            const updateInput = fieldValue[updaterFieldName][
              inflection.patchField(inflection.tableFieldName(foreignTable))
            ];
            const sqlColumns = [];
            const sqlValues = [];
            foreignTable.attributes.forEach((attr) => {
              if (!pgColumnFilter(attr, build, context)) return;
              if (omit(attr, 'update')) return;

              const colFieldName = inflection.column(attr);
              if (colFieldName in updateInput) {
                const val = updateInput[colFieldName];
                sqlColumns.push(sql.identifier(attr.name));
                sqlValues.push(gql2pg(val, attr.type, attr.typeModifier));
              }
            });
            if (sqlColumns.length === 0) {
              return;
            }
            const updateQuery = sql.query`
              update ${sql.identifier(
                foreignTable.namespace.name,
                foreignTable.name,
              )} set ${sql.join(
                sqlColumns.map(
                  (col, i) => sql.fragment`${col} = ${sqlValues[i]}`,
                ),
                ', ',
              )}
              where ${keyWhere}
              returning *`;

            const { text, values } = sql.compile(updateQuery);
            const { rows: updatedRows } = await pgClient.query(text, values);
            const updatedRow = updatedRows[0];
            foreignKeys.forEach((k, idx) => {
              output[inflection.column(keys[idx])] = updatedRow[k.name];
            });
          }));

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
              output[inflection.column(keys[idx])] = resolveResult.data[`__pk__${k.name}`];
            });
          }
        }));

      return output;
    };

    const newResolver = async (data, { input }, { pgClient }, resolveInfo) => {
      const PayloadType = getTypeByName(
        isPgUpdateMutationField
          ? inflection.updatePayloadType(table)
          : inflection.createPayloadType(table),
      );
      const tableFieldName = isPgUpdateMutationField
        ? inflection.patchField(table.name)
        : inflection.tableFieldName(table);
      const parsedResolveInfoFragment = parseResolveInfo(resolveInfo);
      const resolveData = getDataFromParsedResolveInfoFragment(parsedResolveInfoFragment, PayloadType);
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
            .filter(attr => pgColumnFilter(attr, build, context))
            .filter(attr => !omit(attr, 'create'))
            .forEach((attr) => {
              const fieldName = inflection.column(attr);
              const val = inputData[fieldName];
              if (
                Object.prototype.hasOwnProperty.call(
                  inputData,
                  fieldName,
                )
              ) {
                sqlColumns.push(sql.identifier(attr.name));
                sqlValues.push(gql2pg(val, attr.type, attr.typeModifier));
              }
            });

          /* eslint indent: 0 */
          mutationQuery = sql.query`
            insert into ${sql.identifier(table.namespace.name, table.name)}
              ${sqlColumns.length
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
              const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
              const primaryKeys = table.primaryKeyConstraints.keyAttributes;
              if (Type !== TableType) {
                throw new Error('Mismatched type');
              }
              if (identifiers.length !== primaryKeys.length) {
                throw new Error('Invalid ID');
              }
              condition = `${sql.join(
                table.primaryKeyConstraint.keyAttributes.map(
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
            } catch (e) {
              debug(e);
              return null;
            }
          } else {
            const { keyAttributes: keys } = pgFieldConstraint;
            condition = sql.fragment`(${sql.join(
              keys.map(
                key => sql.fragment`${sql.identifier(
                    key.name,
                  )} = ${gql2pg(
                    input[inflection.column(key)],
                    key.type,
                    key.typeModifier,
                  )}`,
              ),
              ') and (',
            )})`;
          }
          table.attributes
            .filter(attr => pgColumnFilter(attr, build, context))
            .filter(attr => !omit(attr, 'update'))
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
              select * from ${sql.identifier(
                table.namespace.name,
                table.name,
              )}
              where ${condition}`;
          }
        }

        const { text, values } = sql.compile(mutationQuery);
        const { rows } = await pgClient.query(text, values);
        const row = rows[0];

        await Promise.all(Object.keys(inputData).map(async (key) => {
          const nestedField = pgNestedPluginReverseInputTypes[table.id]
            .find(obj => obj.name === key);
          if (!nestedField) {
            return;
          }

          const {
            foreignTable,
            keys, // nested table's keys
            foreignKeys, // main mutation table's keys
            isUnique,
          } = nestedField;
          const modifiedRows = [];

          const ForeignTableType = pgGetGqlTypeByTypeIdAndModifier(foreignTable.type.id, null);
          const fieldValue = inputData[key];
          const { primaryKeyConstraint } = foreignTable;
          const primaryKeys = primaryKeyConstraint ? primaryKeyConstraint.keyAttributes : null;

          if (isUnique && Object.keys(fieldValue).length > 1) {
            throw new Error('Unique relations may only create or connect a single row.');
          }

          const foreignTableConnectorFields = pgNestedTableConnectors[foreignTable.id];
          await Promise.all(foreignTableConnectorFields.map(async ({
            fieldName: connectorFieldName,
            isNodeIdConnector,
            constraint,
          }) => {
            if (!(connectorFieldName in fieldValue)) {
              return;
            }
            const connectorField = Array.isArray(fieldValue[connectorFieldName])
              ? fieldValue[connectorFieldName]
              : [fieldValue[connectorFieldName]];

            let where = '';

            if (isNodeIdConnector) {
              const nodes = connectorField.map((k) => {
                const nodeId = k[nodeIdFieldName];
                const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
                if (Type !== ForeignTableType) {
                  throw new Error('Mismatched type');
                }
                if (identifiers.length !== primaryKeys.length) {
                  throw new Error('Invalid ID');
                }
                return identifiers;
              });
              where = sql.fragment`${sql.join(
                primaryKeys.map(
                  (k, idx) => sql.fragment`${sql.join(
                    nodes.map(
                      node => sql.fragment`${sql.identifier(
                        k.name,
                      )} = ${gql2pg(
                        node[idx],
                        k.type,
                        k.typeModifier,
                      )}`,
                    ),
                    ') and (',
                  )}`,
                ),
                ') and (',
              )}`;
            } else {
              const foreignPrimaryKeys = constraint.keyAttributes;
              where = sql.fragment`(${sql.join(
                foreignPrimaryKeys.map(
                  k => sql.fragment`${sql.join(
                    connectorField.map(
                      col => sql.fragment`
                        ${sql.identifier(k.name)} = ${gql2pg(
                          col[inflection.column(k)],
                          k.type,
                          k.typeModifier,
                        )}
                      `,
                    ),
                    ') or (',
                  )})`,
                ),
                ') and (',
              )}`;
            }

            const connectQuery = sql.query`
              update ${sql.identifier(
                foreignTable.namespace.name,
                foreignTable.name,
              )} set ${sql.join(
                keys.map((k, i) => sql.fragment`${sql.identifier(k.name)} = ${sql.value(row[foreignKeys[i].name])}`),
                ', ',
              )}
              where ${where}
              returning *`;
            const {
              text: connectQueryText,
              values: connectQueryValues,
            } = sql.compile(connectQuery);
            const { rows: connectedRows } = await pgClient.query(connectQueryText, connectQueryValues);
            if (primaryKeys) {
              connectedRows.forEach((connectedRow) => {
                const rowKeyValues = {};
                primaryKeys.forEach((k) => {
                  rowKeyValues[k.name] = connectedRow[k.name];
                });
                modifiedRows.push(rowKeyValues);
              });
            }
          }));

          const foreignTableUpdaterFields = pgNestedTableUpdaters[foreignTable.id];
          await Promise.all(foreignTableUpdaterFields.map(async ({
            fieldName: updaterFieldName,
            isNodeIdUpdater,
            constraint,
          }) => {
            if (!(updaterFieldName in fieldValue)) {
              return;
            }
            const updaterField = Array.isArray(fieldValue[updaterFieldName])
              ? fieldValue[updaterFieldName]
              : [fieldValue[updaterFieldName]];

            await Promise.all(updaterField.map(async (node) => {
              let keyWhere = '';
              if (isNodeIdUpdater) {
                const nodeId = node[nodeIdFieldName];
                const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
                if (Type !== ForeignTableType) {
                  throw new Error('Mismatched type');
                }
                if (identifiers.length !== primaryKeys.length) {
                  throw new Error('Invalid ID');
                }
                keyWhere = sql.fragment`(${sql.join(
                  primaryKeys.map(
                    (k, idx) => sql.fragment`
                      ${sql.identifier(
                        k.name,
                      )} = ${gql2pg(
                        identifiers[idx],
                        k.type,
                        k.typeModifier,
                      )}`,
                  ),
                  ') and (',
                )})`;
              } else {
                const foreignPrimaryKeys = constraint.keyAttributes;
                keyWhere = sql.fragment`(${sql.join(
                  foreignPrimaryKeys.map(
                    k => sql.fragment`
                      ${sql.identifier(k.name)} = ${gql2pg(
                        node[inflection.column(k)],
                        k.type,
                        k.typeModifier,
                      )}
                    `,
                  ),
                  ') and (',
                )})`;
              }
              const updateInput = node[
                inflection.patchField(inflection.tableFieldName(foreignTable))
              ];
              const sqlColumns = [];
              const sqlValues = [];
              foreignTable.attributes.forEach((attr) => {
                if (!pgColumnFilter(attr, build, context)) return;
                if (omit(attr, 'update')) return;

                const fieldName = inflection.column(attr);
                if (fieldName in updateInput) {
                  const val = updateInput[fieldName];
                  sqlColumns.push(sql.identifier(attr.name));
                  sqlValues.push(gql2pg(val, attr.type, attr.typeModifier));
                }
              });
              if (sqlColumns.length === 0) {
                return;
              }
              const relationWhere = sql.fragment`
                ${sql.join(
                  keys.map((k, i) => sql.fragment`${sql.identifier(k.name)} = ${sql.value(row[foreignKeys[i].name])}`),
                  ') and (',
                )}
              `;
              const updateQuery = sql.query`
                update ${sql.identifier(
                  foreignTable.namespace.name,
                  foreignTable.name,
                )} set ${sql.join(
                  sqlColumns.map(
                    (col, i) => sql.fragment`${col} = ${sqlValues[i]}`,
                  ),
                  ', ',
                )}
                where (${keyWhere}) and (${relationWhere})
                returning *`;

              const {
                text: updateQueryText,
                values: updateQueryValues,
              } = sql.compile(updateQuery);
              const { rows: updatedRows } = await pgClient.query(updateQueryText, updateQueryValues);
              if (primaryKeys) {
                updatedRows.forEach((updatedRow) => {
                  const rowKeyValues = {};
                  primaryKeys.forEach((k) => {
                    rowKeyValues[k.name] = updatedRow[k.name];
                  });
                  modifiedRows.push(rowKeyValues);
                });
              }
            }));
          }));

          if (fieldValue.create) {
            await Promise.all(fieldValue.create.map(async (rowData) => {
              const resolver = pgNestedResolvers[foreignTable.id];
              const tableVar = inflection.tableFieldName(foreignTable);

              const keyData = {};
              keys.forEach((k, idx) => {
                const columnName = inflection.column(k);
                keyData[columnName] = row[foreignKeys[idx].name];
              });

              const { data: reverseRow } = await resolver(
                data,
                { input: { [tableVar]: Object.assign({}, rowData, keyData) } },
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
            }));
          }
          if (fieldValue.deleteOthers) {
            // istanbul ignore next
            if (!primaryKeys) {
              throw new Error('`deleteOthers` is not supported on foreign relations with no primary key.');
            }
            const keyCondition = sql.fragment`(${sql.join(
              keys.map(
                (k, idx) => sql.fragment`
                  ${sql.identifier(k.name)} = ${sql.value(row[foreignKeys[idx].name])}
                `,
              ),
              ') and (',
            )})`;
            const rowCondition = sql.fragment`
              ${sql.join(
                modifiedRows.map(r => sql.fragment`${sql.join(
                  Object.keys(r).map(
                    k => sql.fragment`
                      ${sql.identifier(k)} <> ${sql.value(r[k])}
                    `,
                  ),
                  ' and ',
                )}`),
                ') and (',
              )}`;

            const deleteQuery = sql.query`
              delete from ${sql.identifier(
                foreignTable.namespace.name,
                foreignTable.name,
              )}
              where (${keyCondition}) and (${rowCondition})`;
            const {
              text: deleteQueryText,
              values: deleteQueryValues,
            } = sql.compile(deleteQuery);
            await pgClient.query(deleteQueryText, deleteQueryValues);
          }
        }));

        let mutationData = null;

        const primaryKeyConstraint = table.constraints.find(con => con.type === 'p');
        if (primaryKeyConstraint) {
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

        await pgClient.query('RELEASE SAVEPOINT graphql_nested_mutation');
        return {
          clientMutationId: input.clientMutationId,
          data: mutationData,
        };
      } catch (e) {
        debug(e);
        await pgClient.query('ROLLBACK TO SAVEPOINT graphql_nested_mutation');
        throw e;
      }
    };

    if (isPgCreateMutationField) {
      pgNestedResolvers[table.id] = newResolver;
    }

    return Object.assign(
      {},
      field,
      { resolve: newResolver },
    );
  });
};
