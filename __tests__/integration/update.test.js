const { graphql } = require('graphql');
const { withSchema } = require('../helpers');

test(
  'forward nested mutation during update',
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
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
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
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const data = result.data.updateParentById.parent;
      expect(data.childrenByParentId.nodes).toHaveLength(3);
      data.childrenByParentId.nodes.map(n => expect(n.parentId).toBe(data.id));
    },
  }),
);

test(
  'deleteOthers removes other records',
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
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const data = result.data.updateParentById.parent;
      expect(data.childrenByParentId.nodes).toHaveLength(2);
      data.childrenByParentId.nodes.map(n => expect(n.parentId).toBe(data.id));
    },
  }),
);

test(
  'deleteOthers is not avaialble when no primary key on the foreign relation',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );
      
      create table p.child (
        id integer,
        parent_id integer,
        name text not null,
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );
      insert into p.parent values(1, 'test');
      insert into p.child values(99, 1, 'test child');
    `,
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
                    id: 1
                    name: "test child 2"
                  }, {
                    id: 2
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
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).toHaveProperty('errors');
      expect(result.errors[0].message).toMatch(/"deleteOthers" is not defined/);
    },
  }),
);
