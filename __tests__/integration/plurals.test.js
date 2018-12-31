const { graphql } = require('graphql');
const { withSchema } = require('../helpers');

test(
  'plural when one-to-many, singular in reverse',
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
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          c1: createParent(
            input: {
              parent: {
                name: "test"
                childrenUsingId: {
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
                parentToParentId: {
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
  'singular when one-to-one',
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
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          c1: createParent(
            input: {
              parent: {
                name: "test"
                childUsingId: {
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
                parentToParentId: {
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
