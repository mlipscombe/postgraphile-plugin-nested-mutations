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
      expect(data.childrenByParentId.nodes.map((n) => n.id)).toEqual([
        95,
        98,
        99,
      ]);
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
      expect(data.childrenByParentId.nodes.map((n) => n.id)).toEqual([
        95,
        97,
        98,
        99,
      ]);
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
      expect(result.errors[0].message).toMatch(
        /"deleteByNodeId" is not defined/,
      );
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
        // eslint-disable-next-line global-require
        require('../../index.js'),
        // eslint-disable-next-line global-require
        require('@graphile-contrib/pg-simplify-inflector'),
      ],
      simpleCollections: 'both',
      legacyRelations: 'omit',
      pgShortPk: true,
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
          o2: updateUserByNodeId(
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

test(
  'forward deeply nested update mutation with nested updateById and create',
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

      create table p.grandchild (
        id serial primary key,
        child_id integer not null,
        name text not null,
        constraint grandchild_child_fkey foreign key (child_id)
          references p.child (id)
      );

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child 1');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                name: "updated parent"
                childrenUsingId: {
                  updateById: {
                    id: 1
                    childPatch: {
                      name: "updated child 1"
                      grandchildrenUsingId: {
                        create: [{ name: "grandchild 1 of child 1" }]
                      }
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
                  grandchildrenByChildId {
                    nodes {
                      id
                      childId
                      name
                    }
                  }
                }
              }
            }
          }
        }
        `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const { data } = result;

      expect(data.updateParentById.parent.name).toEqual('updated parent');
      data.updateParentById.parent.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.updateParentById.parent.id),
      );

      expect(
        data.updateParentById.parent.childrenByParentId.nodes,
      ).toHaveLength(1);
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[0].name,
      ).toEqual('updated child 1');

      expect(
        data.updateParentById.parent.childrenByParentId.nodes[0]
          .grandchildrenByChildId.nodes,
      ).toHaveLength(1);
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[0]
          .grandchildrenByChildId.nodes[0].name,
      ).toEqual('grandchild 1 of child 1');
    },
  }),
);

test(
  'forward deeply nested update mutation with nested updateById',
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

      create table p.grandchild (
        id serial primary key,
        child_id integer not null,
        name text not null,
        constraint grandchild_child_fkey foreign key (child_id)
          references p.child (id)
      );

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child 1');
      insert into p.grandchild values(1, 1, 'test grandchild 1');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                name: "updated parent"
                childrenUsingId: {
                  updateById: {
                    id: 1
                    childPatch: {
                      name: "updated child 1"
                      grandchildrenUsingId: {
                        updateById: {
                          id: 1
                          grandchildPatch: {
                            name: "updated grandchild 1 of child 1"
                          }
                        }
                      }
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
                  grandchildrenByChildId {
                    nodes {
                      id
                      childId
                      name
                    }
                  }
                }
              }
            }
          }
        }
        `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const { data } = result;

      expect(data.updateParentById.parent.name).toEqual(`updated parent`);
      data.updateParentById.parent.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.updateParentById.parent.id),
      );

      expect(
        data.updateParentById.parent.childrenByParentId.nodes,
      ).toHaveLength(1);
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[0].name,
      ).toEqual('updated child 1');

      expect(
        data.updateParentById.parent.childrenByParentId.nodes[0]
          .grandchildrenByChildId.nodes,
      ).toHaveLength(1);
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[0]
          .grandchildrenByChildId.nodes[0].name,
      ).toEqual('updated grandchild 1 of child 1');
    },
  }),
);

test(
  'forward deeply nested update mutation with nested updateById and connectById',
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

      create table p.grandchild (
        id serial primary key,
        child_id integer not null,
        name text not null,
        constraint grandchild_child_fkey foreign key (child_id)
          references p.child (id)
      );

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child 1');
      insert into p.child values(2, 1, 'test child 2');
      insert into p.grandchild values(1, 1, 'test grandchild 1');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                name: "updated parent"
                childrenUsingId: {
                  updateById: {
                    id: 1
                    childPatch: {
                      name: "updated child 1"
                      grandchildrenUsingId: {
                        updateById: {
                          id: 1
                          grandchildPatch: {
                            childToChildId: {
                              connectById: { id: 2 }
                            }
                            name: "changed parent of grandchild 1"
                          }
                        }
                      }
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
                  grandchildrenByChildId {
                    nodes {
                      id
                      childId
                      name
                    }
                  }
                }
              }
            }
          }
        }
        `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const { data } = result;

      expect(data.updateParentById.parent.name).toEqual(`updated parent`);
      data.updateParentById.parent.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.updateParentById.parent.id),
      );

      expect(
        data.updateParentById.parent.childrenByParentId.nodes,
      ).toHaveLength(2);
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[0].name,
      ).toEqual('updated child 1');
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[1].name,
      ).toEqual('test child 2');

      expect(
        data.updateParentById.parent.childrenByParentId.nodes[1]
          .grandchildrenByChildId.nodes,
      ).toHaveLength(1);
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[1]
          .grandchildrenByChildId.nodes[0].childId,
      ).toEqual(2);
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[1]
          .grandchildrenByChildId.nodes[0].name,
      ).toEqual('changed parent of grandchild 1');
    },
  }),
);

test(
  'forward deeply nested update mutation with nested updateById and deleteById',
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

      create table p.grandchild (
        id serial primary key,
        child_id integer not null,
        name text not null,
        constraint grandchild_child_fkey foreign key (child_id)
          references p.child (id)
      );

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child 1');
      insert into p.child values(2, 1, 'test child 2');
      insert into p.grandchild values(1, 1, 'test grandchild 1');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                name: "updated parent"
                childrenUsingId: {
                  updateById: {
                    id: 1
                    childPatch: {
                      name: "updated child 1"
                      grandchildrenUsingId: {
                        deleteById: {
                          id: 1
                        }
                      }
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
                  grandchildrenByChildId {
                    nodes {
                      id
                      childId
                      name
                    }
                  }
                }
              }
            }
          }
        }
        `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const { data } = result;

      expect(data.updateParentById.parent.name).toEqual(`updated parent`);
      data.updateParentById.parent.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.updateParentById.parent.id),
      );

      expect(
        data.updateParentById.parent.childrenByParentId.nodes,
      ).toHaveLength(2);
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[0].name,
      ).toEqual('updated child 1');
      expect(
        data.updateParentById.parent.childrenByParentId.nodes[1].name,
      ).toEqual('test child 2');

      expect(
        data.updateParentById.parent.childrenByParentId.nodes[1]
          .grandchildrenByChildId.nodes,
      ).toHaveLength(0);
    },
  }),
);

test(
  'forward deeply nested mutation with nested updateByNodeId',
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

      create table p.grandchild (
        id serial primary key,
        child_id integer not null,
        name text not null,
        constraint grandchild_child_fkey foreign key (child_id)
          references p.child (id)
      );

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
      insert into p.grandchild values(1, 1, 'test grandchild');
    `,
    test: async ({ schema, pgClient }) => {
      const lookupChildQuery = `
        query {
          childById(id: 1) {
            nodeId
          }
        }
      `;
      const lookupChildResult = await graphql(schema, lookupChildQuery, null, {
        pgClient,
      });
      const { nodeId: childNodeId } = lookupChildResult.data.childById;
      expect(childNodeId).not.toBeUndefined();

      const lookupGrandchildQuery = `
        query {
          grandchildById(id: 1) {
            nodeId
          }
        }
      `;
      const lookupGrandchildResult = await graphql(
        schema,
        lookupGrandchildQuery,
        null,
        {
          pgClient,
        },
      );
      const {
        nodeId: grandchildNodeId,
      } = lookupGrandchildResult.data.grandchildById;
      expect(grandchildNodeId).not.toBeUndefined();

      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  updateByNodeId: {
                    nodeId: "${childNodeId}"
                    childPatch: {
                      name: "renamed child"
                      grandchildrenUsingId: {
                        updateByNodeId: {
                          nodeId: "${grandchildNodeId}"
                          grandchildPatch: {
                            name: "renamed grandchild"
                          }
                        }
                      }
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
                  grandchildrenByChildId {
                    nodes {
                      id
                      childId
                      name
                    }
                  }
                }
              }
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const childData = result.data.updateParentById.parent;
      expect(childData.childrenByParentId.nodes).toHaveLength(1);
      childData.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(childData.id),
      );
      expect(childData.childrenByParentId.nodes[0].name).toEqual(
        'renamed child',
      );

      const grandchildData = childData.childrenByParentId.nodes[0];
      expect(grandchildData.grandchildrenByChildId.nodes).toHaveLength(1);
      grandchildData.grandchildrenByChildId.nodes.map((n) =>
        expect(n.childId).toBe(grandchildData.id),
      );
      expect(grandchildData.grandchildrenByChildId.nodes[0].name).toEqual(
        'renamed grandchild',
      );
    },
  }),
);

test(
  'reverse deeply nested mutation with nested updateById',
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

      create table p.grandchild (
        id serial primary key,
        child_id integer not null,
        name text not null,
        constraint grandchild_child_fkey foreign key (child_id)
          references p.child (id)
      );
      
      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
      insert into p.grandchild values(1, 1, 'test grandchild');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
      mutation {
        updateGrandchildById(
          input: {
            id: 1
            grandchildPatch: {
              childToChildId: {
                updateById: {
                  id: 1
                  childPatch: {
                    parentToParentId: {
                      updateById: { id: 1, parentPatch: { name: "renamed parent" } }
                    }
                  }
                }
              }
            }
          }
        ) {
          grandchild {
            id
            name
            childByChildId {
              id
              name
              parentByParentId {
                id
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

      const child = result.data.updateGrandchildById.grandchild.childByChildId;
      expect(child.parentByParentId).not.toBeNull();
      expect(child.parentByParentId.name).toEqual('renamed parent');
    },
  }),
);

test(
  'reverse deeply nested mutation with nested updateByNodeId',
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

      create table p.grandchild (
        id serial primary key,
        child_id integer not null,
        name text not null,
        constraint grandchild_child_fkey foreign key (child_id)
          references p.child (id)
      );

      insert into p.parent values(1, 'test parent');
      insert into p.child values(1, 1, 'test child');
      insert into p.grandchild values(1, 1, 'test grandchild');
    `,
    test: async ({ schema, pgClient }) => {
      const lookupParentQuery = `
      query {
        parentById(id: 1) {
          nodeId
        }
      }
    `;
      const lookupParentResult = await graphql(
        schema,
        lookupParentQuery,
        null,
        {
          pgClient,
        },
      );
      const { nodeId: parentNodeId } = lookupParentResult.data.parentById;
      expect(parentNodeId).not.toBeUndefined();

      const lookupChildQuery = `
        query {
          childById(id: 1) {
            nodeId
          }
        }
      `;
      const lookupChildResult = await graphql(schema, lookupChildQuery, null, {
        pgClient,
      });
      const { nodeId: childNodeId } = lookupChildResult.data.childById;
      expect(childNodeId).not.toBeUndefined();

      const query = `
        mutation {
          updateGrandchildById(
            input: {
              id: 1
              grandchildPatch: {
                childToChildId: {
                  updateByNodeId: {
                    nodeId: "${childNodeId}"
                    childPatch: {
                      parentToParentId: {
                        updateByNodeId: {
                          nodeId: "${parentNodeId}"
                          parentPatch: {
                            name: "renamed parent"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          ) {
            grandchild {
              id
              name
              childByChildId {
                id
                name
                parentByParentId {
                  id
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

      const child = result.data.updateGrandchildById.grandchild.childByChildId;
      expect(child.parentByParentId).not.toBeNull();
      expect(child.parentByParentId.name).toEqual('renamed parent');
    },
  }),
);

test(
  'forward nested mutation with create and empty nested fields succeeds',
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
      insert into p.parent values(1, 'parent');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  create: {
                    id: 1,
                    parentId: 1,
                    name: "child"
                  },
                  connectByNodeId: []
                  connectById: []
                  deleteByNodeId: []
                  deleteById: []
                  updateByNodeId: []
                  updateById: []
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

      const { parent } = result.data.updateParentById;
      expect(parent.childrenByParentId.nodes).toHaveLength(1);
      expect(parent.id).toBe(1);
      expect(parent.name).toBe('parent');

      const child = parent.childrenByParentId.nodes[0];
      expect(child.id).toBe(1);
      expect(child.name).toBe('child');
      expect(child.parentId).toBe(1);
    },
  }),
);

test(
  'forward nested mutation with updateById and deleteById succeeds',
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

      insert into p.parent values(1, 'parent');
      insert into p.child values(1, 1, 'child to update');
      insert into p.child values(2, 1, 'child to delete');
    `,
    test: async ({ schema, pgClient }) => {
      const newChildName = 'updated child';

      const query = `
        mutation {
          updateParentById(
            input: {
              id: 1
              parentPatch: {
                childrenUsingId: {
                  deleteById: {
                    id: 2
                  }
                  updateById: {
                    id: 1
                    childPatch: {
                      name: "${newChildName}"
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

      const { parent } = result.data.updateParentById;
      expect(parent.childrenByParentId.nodes).toHaveLength(1);
      expect(parent.id).toBe(1);
      expect(parent.name).toBe('parent');

      const child = parent.childrenByParentId.nodes[0];
      expect(child.id).toBe(1);
      expect(child.name).toBe(newChildName);
      expect(child.parentId).toBe(1);
    },
  }),
);
