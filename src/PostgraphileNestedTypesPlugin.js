module.exports = function PostGraphileNestedTypesPlugin(
  builder,
  {
    nestedMutationsSimpleFieldNames = false,
    nestedMutationsDeleteOthers = true,
    nestedMutationsOldUniqueFields = false,
  } = {},
) {
  builder.hook('inflection', (inflection, build) =>
    build.extend(inflection, {
      nestedConnectorType(options) {
        const {
          constraint: {
            name,
            tags: { name: tagName },
          },
          isForward,
        } = options;
        return inflection.upperCamelCase(
          `${tagName || name}_${isForward ? '' : 'Inverse'}_input`,
        );
      },
      nestedCreateInputType(options) {
        const {
          constraint: {
            name,
            tags: { name: tagName },
          },
          foreignTable,
        } = options;
        return inflection.upperCamelCase(
          `${tagName || name}_${foreignTable.name}_create_input`,
        );
      },
    }),
  );

  builder.hook('build', (build) => {
    const { extend, pgOmit: omit, inflection } = build;

    return extend(build, {
      pgNestedPluginForwardInputTypes: {},
      pgNestedPluginReverseInputTypes: {},
      pgNestedResolvers: {},
      pgNestedFieldName(options) {
        const {
          constraint: {
            keyAttributes: keys,
            foreignKeyAttributes: foreignKeys,
            tags: {
              fieldName,
              foreignFieldName,
              forwardMutationName,
              reverseMutationName,
            },
          },
          table,
          isForward,
          foreignTable,
        } = options;
        const tableFieldName = inflection.tableFieldName(foreignTable);
        const keyNames = keys.map((k) => k.name);
        const foreignKeyNames = foreignKeys.map((k) => k.name);

        const constraints = foreignTable.constraints
          .filter((con) => con.type === 'f')
          .filter((con) => con.foreignClass.id === table.id)
          .filter((con) => !omit(con, 'read'));

        const multipleFKs = constraints.length > 1;

        const isUnique = !!foreignTable.constraints.find(
          (c) =>
            (c.type === 'p' || c.type === 'u') &&
            c.keyAttributeNums.length === keys.length &&
            c.keyAttributeNums.every((n, i) => keys[i].num === n),
        );

        const computedReverseMutationName = inflection.camelCase(
          `${
            isUnique
              ? nestedMutationsOldUniqueFields
                ? inflection.pluralize(tableFieldName)
                : tableFieldName
              : inflection.pluralize(tableFieldName)
          }`,
        );

        if (isForward) {
          if (forwardMutationName) {
            return forwardMutationName;
          }
          if (fieldName) {
            return fieldName;
          }
          if (nestedMutationsSimpleFieldNames && !multipleFKs) {
            return inflection.camelCase(`${tableFieldName}`);
          }
          return inflection.camelCase(
            `${tableFieldName}_to_${keyNames.join('_and_')}`,
          );
        }

        // reverse mutation
        if (reverseMutationName) {
          return reverseMutationName;
        }
        if (foreignFieldName) {
          return foreignFieldName;
        }
        if (!multipleFKs) {
          return nestedMutationsSimpleFieldNames
            ? computedReverseMutationName
            : inflection.camelCase(
                `${computedReverseMutationName}_using_${foreignKeyNames.join(
                  '_and_',
                )}`,
              );
        }
        // tables have mutliple relations between them
        return inflection.camelCase(
          `${computedReverseMutationName}_to_${keyNames.join(
            '_and_',
          )}_using_${foreignKeyNames.join('_and_')}`,
        );
      },
    });
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
      pgNestedTableConnectorFields,
      pgNestedTableDeleterFields,
      pgNestedTableUpdaterFields,
      pgNestedFieldName,
      graphql: {
        GraphQLInputObjectType,
        GraphQLList,
        GraphQLNonNull,
        GraphQLBoolean,
      },
    } = build;

    const {
      scope: { isInputType, isPgRowType, pgIntrospection: table },
      GraphQLInputObjectType: gqlType,
    } = context;

    if (!isInputType || !isPgRowType) {
      return fields;
    }

    const foreignKeyConstraints = introspectionResultsByKind.constraint
      .filter((con) => con.type === 'f')
      .filter(
        (con) => con.classId === table.id || con.foreignClassId === table.id,
      )
      .filter((con) => !omit(con, 'read'));

    if (!foreignKeyConstraints.length) {
      // table has no foreign relations
      return fields;
    }

    const tableTypeName = gqlType.name;

    pgNestedPluginForwardInputTypes[table.id] = [];
    pgNestedPluginReverseInputTypes[table.id] = [];

    foreignKeyConstraints.forEach((constraint) => {
      const isForward = constraint.classId === table.id;
      const foreignTable = isForward
        ? introspectionResultsByKind.classById[constraint.foreignClassId]
        : introspectionResultsByKind.classById[constraint.classId];

      // istanbul ignore next
      if (!foreignTable) {
        throw new Error(
          `Could not find the foreign table (constraint: ${constraint.name})`,
        );
      }

      const foreignTableName = inflection.tableFieldName(foreignTable);

      const foreignUniqueConstraints = foreignTable.constraints
        .filter((con) => con.type === 'u' || con.type === 'p')
        .filter((con) => !con.keyAttributes.some((key) => omit(key)));

      const connectable = !!foreignUniqueConstraints.length;
      const creatable =
        !omit(foreignTable, 'create') &&
        !omit(constraint, 'create') &&
        !constraint.keyAttributes.some((key) => omit(key, 'create'));
      const updateable =
        !omit(foreignTable, 'update') && !omit(constraint, 'update');
      const deleteable =
        nestedMutationsDeleteOthers &&
        foreignTable.primaryKeyConstraint &&
        !omit(foreignTable, 'delete') &&
        !omit(constraint, 'delete');

      if (
        (!connectable && !creatable && !deleteable && !updateable) ||
        omit(foreignTable, 'read')
        // || primaryKey.keyAttributes.some(key => omit(key, 'read'))
        // || foreignPrimaryKey.keyAttributes.some(key => omit(key, 'read'))
      ) {
        return;
      }

      const keys = constraint.keyAttributes;
      const isUnique = !!foreignTable.constraints.find(
        (c) =>
          (c.type === 'p' || c.type === 'u') &&
          c.keyAttributeNums.length === keys.length &&
          c.keyAttributeNums.every((n, i) => keys[i].num === n),
      );

      const fieldName = pgNestedFieldName({
        constraint,
        table,
        foreignTable,
        isForward,
      });

      const createInputTypeName = inflection.nestedCreateInputType({
        constraint,
        table,
        foreignTable,
        isForward,
      });

      const connectorTypeName = inflection.nestedConnectorType({
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
            const gqlForeignTableType = getGqlInputTypeByTypeIdAndModifier(
              foreignTable.type.id,
              null,
            );
            const operations = {};

            if (!isForward && deleteable) {
              operations.deleteOthers = {
                description: `Flag indicating whether all other \`${foreignTableName}\` records that match this relationship should be removed.`,
                type: GraphQLBoolean,
              };
            }
            pgNestedTableConnectorFields[foreignTable.id].forEach(
              ({ field, fieldName: connectorFieldName }) => {
                operations[connectorFieldName] = {
                  description: `The primary key(s) for \`${foreignTableName}\` for the far side of the relationship.`,
                  type: isForward
                    ? field
                    : isUnique
                    ? field
                    : new GraphQLList(new GraphQLNonNull(field)),
                };
              },
            );
            if (deleteable) {
              pgNestedTableDeleterFields[foreignTable.id].forEach(
                ({ field, fieldName: deleterFieldName }) => {
                  operations[deleterFieldName] = {
                    description: `The primary key(s) for \`${foreignTableName}\` for the far side of the relationship.`,
                    type: isForward
                      ? field
                      : isUnique
                      ? field
                      : new GraphQLList(new GraphQLNonNull(field)),
                  };
                },
              );
            }
            if (pgNestedTableUpdaterFields[table.id][constraint.id]) {
              pgNestedTableUpdaterFields[table.id][constraint.id].forEach(
                ({ field, fieldName: updaterFieldName }) => {
                  operations[updaterFieldName] = {
                    description: `The primary key(s) and patch data for \`${foreignTableName}\` for the far side of the relationship.`,
                    type: isForward
                      ? field
                      : isUnique
                      ? field
                      : new GraphQLList(new GraphQLNonNull(field)),
                  };
                },
              );
            }
            if (creatable && gqlForeignTableType) {
              const createInputType = newWithHooks(
                GraphQLInputObjectType,
                {
                  name: createInputTypeName,
                  description: `The \`${foreignTableName}\` to be created by this mutation.`,
                  fields: () => {
                    const inputFields = gqlForeignTableType._fields;
                    const omittedFields = constraint.keyAttributes.map((k) =>
                      inflection.column(k),
                    );
                    return Object.keys(inputFields)
                      .filter((key) => !omittedFields.includes(key))
                      .map((k) => Object.assign({}, { [k]: inputFields[k] }))
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

              operations.create = {
                description: `A \`${
                  gqlForeignTableType.name
                }\` object that will be created and connected to this object.`,
                type: isForward
                  ? createInputType
                  : new GraphQLList(new GraphQLNonNull(createInputType)),
              };
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

      if (isForward) {
        pgNestedPluginForwardInputTypes[table.id].push({
          name: fieldName,
          constraint,
          table,
          foreignTable,
          keys: constraint.keyAttributes,
          foreignKeys: constraint.foreignKeyAttributes,
          connectorInputField,
          isUnique,
        });
      } else {
        pgNestedPluginReverseInputTypes[table.id].push({
          name: fieldName,
          constraint,
          table,
          foreignTable,
          keys: constraint.keyAttributes,
          foreignKeys: constraint.foreignKeyAttributes,
          connectorInputField,
          isUnique,
        });
      }
    });

    return fields;
  });
};
