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
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
    },
  }),
);

test(
  'deleteById removes records',
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
      insert into p.child values(95, 1, 'test child 1');
      insert into p.child values(96, 1, 'test child 2');
      insert into p.child values(97, 1, 'test child 3');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  deleteById: [{id: 96}, {id: 97}]
                  create: [{
                    id: 98
                    name: "test child 4"
                  }, {
                    id: 99
                    name: "test child 5"
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
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
      expect(data.childrenByParentId.nodes.map(n => n.id))
        .toEqual([95, 98, 99]);
    },
  }),
);

test(
  'deleteById is not available if foreign table has @omit delete',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );

      create table p.child (
        id integer primary key,
        parent_id integer,
        name text not null,
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );

      comment on table p.child is E'@omit delete';

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
                  deleteById: {id: 99}
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
      expect(result.errors[0].message).toMatch(/"deleteById" is not defined/);
    },
  }),
);

test(
  'deleteByNodeId removes records',
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
      insert into p.child values(95, 1, 'test child 1');
      insert into p.child values(96, 1, 'test child 1');
      insert into p.child values(97, 1, 'test child 1');
    `,
    test: async ({ schema, pgClient }) => {
      const lookupQuery = `
        query {
          childById(id: 96) {
            nodeId
          }
        }
      `;
      const lookupResult = await graphql(schema, lookupQuery, null, {
        pgClient,
      });
      const { nodeId } = lookupResult.data.childById;
      expect(nodeId).not.toBeUndefined();

      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  deleteByNodeId: [{nodeId: "${nodeId}"}]
                  create: [{
                    id: 98
                    name: "test child 4"
                  }, {
                    id: 99
                    name: "test child 5"
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
      expect(data.childrenByParentId.nodes).toHaveLength(4);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
      expect(data.childrenByParentId.nodes.map(n => n.id))
        .toEqual([95, 97, 98, 99]);
    },
  }),
);

test(
  'deleteByNodeId is not available if foreign table has @omit delete',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );

      create table p.child (
        id integer primary key,
        parent_id integer,
        name text not null,
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );

      comment on table p.child is E'@omit delete';

      insert into p.parent values(1, 'test');
      insert into p.child values(99, 1, 'test child');
    `,
    test: async ({ schema, pgClient }) => {
      const lookupQuery = `
        query {
          childById(id: 99) {
            nodeId
          }
        }
      `;
      const lookupResult = await graphql(schema, lookupQuery, null, {
        pgClient,
      });
      const { nodeId } = lookupResult.data.childById;
      expect(nodeId).not.toBeUndefined();

      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  deleteByNodeId: {nodeId: "${nodeId}"}
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
      expect(result.errors[0].message)
        .toMatch(/"deleteByNodeId" is not defined/);
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
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
    },
  }),
);

test(
  'deleteOthers removes all records if none are modified',
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
      expect(data.childrenByParentId.nodes).toHaveLength(0);
    },
  }),
);

test(
  'deleteOthers is not available when no primary key on the foreign relation',
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

test(
  'deleteOthers is not available if foreign table has @omit delete',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );
      
      create table p.child (
        id integer primary key,
        parent_id integer,
        name text not null,
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );

      comment on table p.child is E'@omit delete';

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

test(
  'forward nested mutation with nested update',
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

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  updateById: {
                    id: 1
                    childPatch: {
                      name: "renamed child"
                    }
                  }
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
      expect(data.childrenByParentId.nodes).toHaveLength(1);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
      expect(data.childrenByParentId.nodes[0].name).toEqual('renamed child');
    },
  }),
);

test(
  'forward nested mutation with nested updateByNodeId',
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

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
    `,
    test: async ({ schema, pgClient }) => {
      const lookupQuery = `
        query {
          childById(id: 1) {
            nodeId
          }
        }
      `;
      const lookupResult = await graphql(schema, lookupQuery, null, {
        pgClient,
      });
      const { nodeId } = lookupResult.data.childById;
      expect(nodeId).not.toBeUndefined();

      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  updateByNodeId: {
                    nodeId: "${nodeId}"
                    childPatch: {
                      name: "renamed child"
                    }
                  }
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
      expect(data.childrenByParentId.nodes).toHaveLength(1);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
      expect(data.childrenByParentId.nodes[0].name).toEqual('renamed child');
    },
  }),
);

test(
  'updateByNodeId with composite primary key works',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );
      
      create table p.child (
        id integer not null,
        parent_id integer,
        name text not null,
        constraint child_pkey primary key (id, parent_id, name),
        constraint child_parent_fkey foreign key (parent_id)
          references p.parent (id)
      );

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
    `,
    test: async ({ schema, pgClient }) => {
      const lookupQuery = `
        query {
          childByIdAndParentIdAndName(id: 1, parentId: 1, name: "test child") {
            nodeId
          }
        }
      `;
      const lookupResult = await graphql(schema, lookupQuery, null, {
        pgClient,
      });
      const { nodeId } = lookupResult.data.childByIdAndParentIdAndName;
      expect(nodeId).not.toBeUndefined();

      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  updateByNodeId: {
                    nodeId: "${nodeId}"
                    childPatch: {
                      name: "renamed child"
                    }
                  }
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
      expect(data.childrenByParentId.nodes).toHaveLength(1);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
      expect(data.childrenByParentId.nodes[0].name).toEqual('renamed child');
    },
  }),
);

test(
  'reverse nested mutation with nested update',
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

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateChildById(
            input: {
              id: 1
              childPatch: {
                parentToParentId: {
                  updateById: {
                    id: 1
                    parentPatch: {
                      name: "renamed parent"
                    }
                  }
                }
              }
            }
          ) {
            child {
              id
              name
              parentByParentId {
                id
                name
              }
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const data = result.data.updateChildById.child;
      expect(data.parentByParentId).not.toBeNull();
      expect(data.parentByParentId.name).toEqual('renamed parent');
    },
  }),
);

test(
  'forward nested mutation with nested update does not accept updates to constraint keys',
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

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  updateById: {
                    id: 1
                    childPatch: {
                      parentId: 7
                      name: "renamed child"
                    }
                  }
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
      expect(result.errors[0].message).toMatch(/"parentId" is not defined/);
    },
  }),
);

test(
  'updateByNodeId does not error',
  withSchema({
    setup: `
      CREATE TABLE p."user" (
        "id" bigint PRIMARY KEY DEFAULT 1,
        "username" text NOT NULL UNIQUE,
        "name" text NOT NULL,
        "avatar" text,
        "description" text,
        "favorite_count" integer DEFAULT 0 NOT NULL
      );
      CREATE TABLE p."user_private" (
        "id" bigint NOT NULL PRIMARY KEY REFERENCES p."user"("id") ON DELETE CASCADE ON UPDATE CASCADE DEFAULT 1,
        -- "email" text UNIQUE NOT NULL,
        "update" boolean DEFAULT false NOT NULL,
        "settings" jsonb DEFAULT '{}'::jsonb,
        "notification_email" jsonb DEFAULT '{}'::jsonb
      )
      with (fillfactor=85);
      comment on constraint user_private_id_fkey on p.user_private is
        E'@foreignFieldName private\n@fieldName user'; -- User { private }
    `,
    options: {
      appendPlugins: [
        require('../../index.js'),
        require('@graphile-contrib/pg-simplify-inflector'),
      ],
      simpleCollections: 'both',
      legacyRelations: 'omit',
      graphileBuildOptions: {
        nestedMutationsDeleteOthers: false,
        nestedMutationsSimpleFieldNames: true,
      },
    },
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation createUser {
          o1: createUser(input: {
            user: {
              username:"yey"
              name: "u"
            }
          }) {
            user {
              id
              name
              username
            }
          }
          o2: updateUser(
            input: {
              nodeId: "WyJ1c2VycyIsMV0="
              patch: {
                name: "this"
              }
            }
          ) {
            user {
              name
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
  'update with no row matched works',
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

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 2
              parentPatch: {
                name: "other name"
              }
            }
          ) {
            parent {
              id
              name
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
