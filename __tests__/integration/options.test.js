const { graphql } = require('graphql');
const { withSchema } = require('../helpers');

test(
  'simple names, plural when one-to-many, singular in reverse',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );
      
      create table p.child (
        id serial primary key,
        parent_id integer,
        name text not null,
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );   
    `,
    options: {
      graphileBuildOptions: {
        nestedMutationsSimpleFieldNames: true,
      },
    },
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          c1: createParent(
            input: {
              parent: {
                name: "test"
                children: {
                  create: [{
                    name: "test child"
                  }]
                }
              }
            }
          ) {
            parent {
              id
            }
          }

          c2: createChild(
            input: {
              child: {
                name: "child"
                parent: {
                  create: {
                    name: "child's parent"
                  }
                }
              }
            }
          ) {
            child {
              id
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');
    },
  }),
);

test(
  'simple names, singular when one-to-one',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );
      
      create table p.child (
        parent_id serial primary key,
        name text not null,
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );   
    `,
    options: {
      graphileBuildOptions: {
        nestedMutationsSimpleFieldNames: true,
      },
    },
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          c1: createParent(
            input: {
              parent: {
                name: "test"
                child: {
                  create: {
                    name: "test child"
                  }
                }
              }
            }
          ) {
            parent {
              id
            }
          }

          c2: createChild(
            input: {
              child: {
                name: "child"
                parent: {
                  create: {
                    name: "child's parent"
                  }
                }
              }
            }
          ) {
            child {
              parentId
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');
    },
  }),
);

test(
  'deleteOthers is not avaialble when disabled',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );
      
      create table p.child (
        id serial primary key,
        parent_id integer,
        name text not null,
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );
      insert into p.parent values(1, 'test');
      insert into p.child values(99, 1, 'test child');
    `,
    options: {
      graphileBuildOptions: {
        nestedMutationsDeleteOthers: false,
      },
    },
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  deleteOthers: true
                  create: [{
                    name: "test child 2"
                  }, {
                    name: "test child 3"
                  }]
                }
              }
            }
          ) {
            parent {
              id
              name
              childrenByParentId {
                nodes {
                  id
                  parentId
                  name
                }
              }
            }
          }
        }
      `;
      const result = await graphql(schema, query, null, { pgClient });
      expect(result).toHaveProperty('errors');
      expect(result.errors[0].message).toMatch(/"deleteOthers" is not defined/);
    },
  }),
);

test(
  'still plural when one-to-one if nestedMutationsOldUniqueFields is enabled',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );
      
      create table p.child (
        parent_id serial primary key,
        name text not null,
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );   
    `,
    options: {
      graphileBuildOptions: {
        nestedMutationsOldUniqueFields: true,
      },
    },
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test"
                childrenUsingId: {
                  create: {
                    name: "test child"
                  }
                }
              }
            }
          ) {
            parent {
              id
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');
    },
  }),
);

// from https://github.com/mlipscombe/postgraphile-plugin-nested-mutations/issues/40
test(
  'id fields are renamed rowId when classicIds is enabled',
  withSchema({
    setup: `
      create table p.parent (
        id uuid primary key default public.uuid_generate_v4(),
        name text not null
      );
      create table p.child (
        id uuid primary key default public.uuid_generate_v4(),
        parent_id uuid references p.parent on delete set null,
        name text not null
      );
    `,
    options: {
      classicIds: true,
    },
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test"
                childrenUsingRowId: {
                  create: {
                    name: "test child"
                  }
                }
              }
            }
          ) {
            parent {
              id
              rowId
              childrenByParentId {
                nodes {
                  id
                  rowId
                }
              }
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');
    },
  }),
);
