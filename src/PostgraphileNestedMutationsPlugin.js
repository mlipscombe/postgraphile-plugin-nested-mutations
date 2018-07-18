const debugFactory = require('debug');

const debug = debugFactory('postgraphile-plugin-nested-mutations');

module.exports = function PostGraphileNestedMutationPlugin(builder) {
  builder.hook('build', (build) => {
    const { inflection } = build;
    return build.extend(build, {
      pgNestedPluginForwardInputTypes: {},
      pgNestedPluginReverseInputTypes: {},
      pgNestedResolvers: {},
      pgNestedConnectorTypeName(options) {
        const {
          constraint: {
            name,
            tags: {
              name: tagName,
            },
          },
          isForward,
        } = options;
        return inflection.upperCamelCase(`${tagName || name}_${isForward ? '' : 'Inverse'}_input`);
      },
      pgNestedConnectInputTypeName(options) {
        const {
          constraint: {
            name,
            tags: {
              name: tagName,
            },
          },
          foreignTable,
        } = options;
        return inflection.upperCamelCase(`${tagName || name}_${foreignTable.name}_connect_input`);
      },
      pgNestedCreateInputTypeName(options) {
        const {
          constraint: {
            name,
            tags: {
              name: tagName,
            },
          },
          foreignTable,
        } = options;
        return inflection.upperCamelCase(`${tagName || name}_${foreignTable.name}_create_input`);
      },
      pgNestedFieldName(options) {
        const {
          constraint: {
            tags: {
              forwardMutationName,
              reverseMutationName,
            },
          },
          isForward,
          foreignTable,
          keys,
          foreignKeys,
        } = options;
        const tableFieldName = inflection.tableFieldName(foreignTable);
        const keyNames = keys.map(k => k.name);
        const foreignKeyNames = foreignKeys.map(k => k.name);
        return isForward
          ? forwardMutationName || inflection.camelCase(`${tableFieldName}_to_${keyNames.join('_and_')}`)
          : reverseMutationName || inflection.camelCase(`${inflection.pluralize(tableFieldName)}_using_${foreignKeyNames.join('_and_')}`);
      },
    });
  });

  builder.hook('GraphQLObjectType:fields:field', (field, build, context) => {
    const {
      inflection,
      pgSql: sql,
      pgOmit: omit,
      gql2pg,
      parseResolveInfo,
      getTypeByName,
      pgColumnFilter,
      pgQueryFromResolveData: queryFromResolveData,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgGetGqlInputTypeByTypeIdAndModifier: getGqlInputTypeByTypeIdAndModifier,
      pgNestedPluginForwardInputTypes,
      pgNestedPluginReverseInputTypes,
      pgNestedResolvers,
      pgViaTemporaryTable: viaTemporaryTable,
    } = build;

    const {
      scope: {
        isPgCreateMutationField,
        pgFieldIntrospection: table,
      },
      addArgDataGenerator,
      getDataFromParsedResolveInfoFragment,
    } = context;

    if (!isPgCreateMutationField) {
      return field;
    }

    const TableInputType = getGqlInputTypeByTypeIdAndModifier(table.type.id, null);

    if (!pgNestedPluginForwardInputTypes[TableInputType.name] && !pgNestedPluginReverseInputTypes[TableInputType.name]) {
      pgNestedResolvers[TableInputType.name] = field.resolve;
      return field;
    }

    const reverseMutations = pgNestedPluginReverseInputTypes[TableInputType.name];
    if (reverseMutations.length) {
      addArgDataGenerator(() => ({
        pgQuery: (queryBuilder) => {
          const keys = reverseMutations.reduce((acc, { foreignKeys }) => acc.concat(foreignKeys), []);
          keys.forEach((key) => {
            queryBuilder.select(
              sql.fragment`${queryBuilder.getTableAlias()}.${sql.identifier(key.name)}`,
              `__pk__${key.name}`,
            );
          });
        },
      }));
    }

    const recurseForwardNestedMutations = async (inputType, data, { input }, { pgClient }, resolveInfo) => {
      const nestedFields = pgNestedPluginForwardInputTypes[inputType.name];
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

          if (fieldValue.connect) {
            const select = foreignKeys.map(k => sql.identifier(k.name));
            const where = foreignKeys.map(k => sql.fragment`
              ${sql.identifier(k.name)} = ${sql.value(fieldValue.connect[inflection.column(k)])}
            `);
            const connectQuery = sql.query`
              select ${sql.join(select, ', ')}
              from ${sql.identifier(foreignTable.namespace.name, foreignTable.name)}
              where ${sql.join(where, ' AND ')}
            `;
            const { text, values } = sql.compile(connectQuery);
            const { rows: connectedRows } = await pgClient.query(text, values);
            const connectedRow = connectedRows[0];
            foreignKeys.forEach((k, idx) => {
              output[inflection.column(keys[idx])] = connectedRow[k.name];
            });
          } else if (fieldValue.create) {
            const createData = fieldValue.create;
            const gqlForeignTableType = getGqlInputTypeByTypeIdAndModifier(foreignTable.type.id, null);
            const resolver = pgNestedResolvers[gqlForeignTableType.name];
            const tableVar = inflection.tableFieldName(foreignTable);

            const insertData = Object.assign(
              {},
              createData,
              await recurseForwardNestedMutations(
                gqlForeignTableType,
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
      const PayloadType = getTypeByName(inflection.createPayloadType(table));
      const tableFieldName = inflection.tableFieldName(table);
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
        const inputData = Object.assign(
          {},
          input[tableFieldName],
          await recurseForwardNestedMutations(
            TableInputType,
            data,
            { input: input[tableFieldName] },
            { pgClient },
            resolveInfo,
          ),
        );

        const sqlColumns = [];
        const sqlValues = [];
        introspectionResultsByKind.attribute
          .filter(attr => attr.classId === table.id)
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
              sqlValues.push(gql2pg(val, attr.type, null));
            }
          });

        /* eslint indent: 0 */
        const mutationQuery = sql.query`
          insert into ${sql.identifier(table.namespace.name, table.name)}
            ${sqlColumns.length
              ? sql.fragment`(
                  ${sql.join(sqlColumns, ', ')}
                ) values(${sql.join(sqlValues, ', ')})`
              : sql.fragment`default values`
            } returning *`;
        const { text, values } = sql.compile(mutationQuery);
        const { rows: insertedRows } = await pgClient.query(text, values);
        const insertedRow = insertedRows[0];

        await Promise.all(Object.keys(inputData).map(async (key) => {
          const nestedField = pgNestedPluginReverseInputTypes[TableInputType.name]
            .find(obj => obj.name === key);
          if (!nestedField) {
            return;
          }

          if (inputData[key].connect) {
            // update foreign record to have this mutation's ID
            throw new Error('`connect` is currently not supported for forward nested mutations.');
          } else if (inputData[key].create) {
            await Promise.all(inputData[key].create.map(async (rowData) => {
              const {
                foreignTable,
                keys, // nested table's keys
                foreignKeys, // main mutation table's keys
              } = nestedField;
              const gqlForeignTableType = getGqlInputTypeByTypeIdAndModifier(foreignTable.type.id, null);
              const resolver = pgNestedResolvers[gqlForeignTableType.name];
              const tableVar = inflection.tableFieldName(foreignTable);

              const keyData = {};
              keys.forEach((k, idx) => {
                const columnName = inflection.column(k);
                keyData[columnName] = insertedRow[foreignKeys[idx].name];
              });

              await resolver(
                data,
                { input: { [tableVar]: Object.assign({}, rowData, keyData) } },
                { pgClient },
                resolveInfo,
              );
            }));
          }
        }));

        const primaryKeyConstraint = introspectionResultsByKind.constraint
          .filter(con => con.type === 'p')
          .find(con => con.classId === table.id);
        const primaryKeyFields = introspectionResultsByKind.attribute
          .filter(attr => attr.classId === table.id)
          .filter(attr => primaryKeyConstraint.keyAttributeNums.includes(attr.num));

        const where = [];
        primaryKeyFields.forEach((f) => {
          where.push(sql.fragment`
            ${sql.identifier(f.name)} = ${sql.value(insertedRow[f.name])}
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

        await pgClient.query('RELEASE SAVEPOINT graphql_nested_mutation');
        return {
          clientMutationId: input.clientMutationId,
          data: finalRows[0],
        };
      } catch (e) {
        await pgClient.query('ROLLBACK TO SAVEPOINT graphql_nested_mutation');
        throw e;
      }
    };

    pgNestedResolvers[TableInputType.name] = newResolver;

    return Object.assign(
      {},
      field,
      { resolve: newResolver },
    );
  });

  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      inflection,
      newWithHooks,
      pgOmit: omit,
      pgGetGqlInputTypeByTypeIdAndModifier: getGqlInputTypeByTypeIdAndModifier,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgNestedPluginForwardInputTypes,
      pgNestedPluginReverseInputTypes,
      pgNestedConnectorTypeName,
      pgNestedConnectInputTypeName,
      pgNestedCreateInputTypeName,
      pgNestedFieldName,
      graphql: {
        GraphQLInputObjectType,
        GraphQLList,
        GraphQLNonNull,
      },
    } = build;

    const {
      scope: {
        isInputType,
        isPgRowType,
        pgIntrospection: table,
      },
      GraphQLInputObjectType: gqlType,
    } = context;

    if (!isInputType || !isPgRowType) {
      return fields;
    }

    const foreignKeyConstraints = introspectionResultsByKind.constraint
      .filter(con => con.type === 'f')
      .filter(con => con.classId === table.id || con.foreignClassId === table.id)
      .filter(con => !omit(con, 'read'));

    const attributes = introspectionResultsByKind.attribute
      .filter(attr => attr.classId === table.id)
      .sort((a, b) => a.num - b.num);

    if (!foreignKeyConstraints.length) {
      // table has no foreign relations
      return fields;
    }

    const tableTypeName = gqlType.name;

    pgNestedPluginForwardInputTypes[gqlType.name] = [];
    pgNestedPluginReverseInputTypes[gqlType.name] = [];

    const nestedFields = {};

    foreignKeyConstraints.forEach((constraint) => {
      const isForward = constraint.classId === table.id;
      const foreignTable = isForward
        ? introspectionResultsByKind.classById[constraint.foreignClassId]
        : introspectionResultsByKind.classById[constraint.classId];

      if (!foreignTable) {
        throw new Error(`Could not find the foreign table (constraint: ${constraint.name})`);
      }

      const foreignTableName = inflection.tableFieldName(foreignTable);
      const foreignAttributes = introspectionResultsByKind.attribute
        .filter(attr => attr.classId === foreignTable.id)
        .sort((a, b) => a.num - b.num);

      const keys = isForward
        ? constraint.keyAttributeNums.map(num => attributes.filter(attr => attr.num === num)[0])
        : constraint.keyAttributeNums.map(num => foreignAttributes.filter(attr => attr.num === num)[0]);
      const foreignKeys = isForward
        ? constraint.foreignKeyAttributeNums.map(num => foreignAttributes.filter(attr => attr.num === num)[0])
        : constraint.foreignKeyAttributeNums.map(num => attributes.filter(attr => attr.num === num)[0]);

      const foreignPrimaryKeyConstraint = introspectionResultsByKind.constraint
        .filter(con => con.type === 'p')
        .find(con => con.classId === foreignTable.id);

      if (!keys.every(_ => _) || !foreignKeys.every(_ => _)) {
        throw new Error('Could not find key columns!');
      }
      if (
        omit(foreignTable, 'read') ||
        keys.some(key => omit(key, 'read')) ||
        foreignKeys.some(key => omit(key, 'read')) ||
        (!foreignPrimaryKeyConstraint && omit(foreignTable, 'create'))
      ) {
        return;
      }

      const fieldName = pgNestedFieldName({
        constraint,
        table,
        keys,
        foreignTable,
        foreignKeys,
        isForward,
      });

      const createInputTypeName = pgNestedCreateInputTypeName({
        constraint,
        table,
        foreignTable,
        isForward,
      });

      const connectInputTypeName = pgNestedConnectInputTypeName({
        constraint,
        table,
        foreignTable,
        isForward,
      });

      const connectInputType = newWithHooks(
        GraphQLInputObjectType,
        {
          name: connectInputTypeName,
          description: `The fields on \`${foreignTableName}\` to look up the row to connect.`,
          fields: () => {
            const gqlForeignTableType = getGqlInputTypeByTypeIdAndModifier(foreignTable.type.id, null);
            const inputFields = gqlForeignTableType._fields;

            const primaryKeyFields = introspectionResultsByKind.attribute
              .filter(attr => attr.classId === foreignTable.id)
              .filter(attr => foreignPrimaryKeyConstraint.keyAttributeNums.includes(attr.num));

            return Object.keys(inputFields)
              .filter(key => primaryKeyFields.map(pkf => inflection.column(pkf)).includes(key))
              .map(k => Object.assign({}, { [k]: inputFields[k] }))
              .reduce((res, o) => Object.assign(res, o), {});
          },
        },
        {
          isNestedMutationInputType: true,
          isNestedMutationConnectInputType: true,
          isNestedInverseMutation: !isForward,
          pgInflection: table,
          pgNestedForeignInflection: foreignTable,
        },
      );

      const createInputType = newWithHooks(
        GraphQLInputObjectType,
        {
          name: createInputTypeName,
          description: `The \`${foreignTableName}\` to be created by this mutation.`,
          fields: () => {
            const gqlForeignTableType = getGqlInputTypeByTypeIdAndModifier(foreignTable.type.id, null);
            const inputFields = gqlForeignTableType._fields;
            const omittedFields = keys.map(k => inflection.column(k));
            return Object.keys(inputFields)
              .filter(key => !omittedFields.includes(key))
              .map(k => Object.assign({}, { [k]: inputFields[k] }))
              .reduce((res, o) => Object.assign(res, o), {});
          },
        },
        {
          isNestedMutationInputType: true,
          isNestedMutationCreateInputType: true,
          isNestedInverseMutation: !isForward,
          pgInflection: table,
          pgNestedForeignInflection: foreignTable,
        },
      );

      const connectorTypeName = pgNestedConnectorTypeName({
        constraint,
        table,
        foreignTable,
        isForward,
      });

      const connectorInputField = newWithHooks(
        GraphQLInputObjectType,
        {
          name: connectorTypeName,
          description: `Input for the nested mutation of \`${foreignTableName}\` in the \`${tableTypeName}\` mutation.`,
          fields: () => {
            const gqlForeignTableType = getGqlInputTypeByTypeIdAndModifier(foreignTable.type.id, null);
            const operations = {};
            if (foreignPrimaryKeyConstraint) {
              operations.connect = {
                description: `The primary key(s) for \`${foreignTableName}\` for the far side of the relationship.`,
                type: isForward ? connectInputType : new GraphQLList(new GraphQLNonNull(connectInputType)),
              };
            } else {
              debug(`Could not determine primary keys for table with id ${isForward ? constraint.foreignClassId : constraint.classId}`);
            }
            if (!omit(foreignTable, 'create')) {
              if (gqlForeignTableType) {
                operations.create = {
                  description: `A \`${gqlForeignTableType.name}\` object that will be created and connected to this object.`,
                  type: isForward ? createInputType : new GraphQLList(new GraphQLNonNull(createInputType)),
                };
              } else {
                debug(`Could not determine type for foreign table with id ${isForward ? constraint.foreignClassId : constraint.classId}`);
              }
            }
            return operations;
          },
        },
        {
          isNestedMutationConnectorType: true,
          isNestedInverseMutation: !isForward,
          pgInflection: table,
          pgNestedForeignInflection: foreignTable,
        },
      );

      nestedFields[fieldName] = Object.assign(
        {},
        fields[fieldName],
        { type: connectorInputField },
      );

      if (isForward) {
        // Make all keys nullable.
        keys.forEach((k) => {
          const keyFieldName = inflection.column(k);
          nestedFields[keyFieldName] = Object.assign(
            {},
            fields[keyFieldName],
            { type: getGqlInputTypeByTypeIdAndModifier(k.typeId, k.typeModifier) },
          );
        });

        pgNestedPluginForwardInputTypes[gqlType.name].push({
          name: fieldName,
          connectInputType,
          createInputType,
          constraint,
          table,
          foreignTable,
          keys,
          foreignKeys,
        });
      } else {
        pgNestedPluginReverseInputTypes[gqlType.name].push({
          name: fieldName,
          connectInputType,
          createInputType,
          constraint,
          table,
          foreignTable,
          keys,
          foreignKeys,
        });
      }
    });

    return Object.assign({}, fields, nestedFields);
  });
};
