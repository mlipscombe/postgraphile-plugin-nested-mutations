const { graphql } = require('graphql');
const { withSchema } = require('../helpers');

test(
  '@omit create on child table inhibits nested create',
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
      comment on table p.child is E'@omit create';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  create: [{
                    name: "child 1 of test f1"
                  }, {
                    name: "child 2 of test f1"
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
      expect(result.errors[0].message).toMatch(/"create" is not defined/);
    },
  }),
);

test(
  '@omit on foreign key inhibits nested mutation',
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
      comment on constraint child_parent_fkey on p.child is E'@omit';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  create: [{
                    name: "child 1 of test f1"
                  }, {
                    name: "child 2 of test f1"
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
        /"childrenUsingId" is not defined/,
      );
    },
  }),
);

test(
  '@omit create on column in foreign key inhibits nested mutation',
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
      comment on column p.child.parent_id is E'@omit create';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  create: [{
                    name: "child 1 of test f1"
                  }, {
                    name: "child 2 of test f1"
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
      expect(result.errors[0].message).toMatch(/"create" is not defined/);
    },
  }),
);

test(
  '@omit create on column referenced column parent table does not inhibit nested mutation',
  withSchema({
    setup: `
      create table p.parent (
        id serial primary key,
        name text not null
      );
      comment on column p.parent.id is E'@omit create';
      
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
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  create: [{
                    name: "child 1 of test f1"
                  }, {
                    name: "child 2 of test f1"
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

      const data = result.data.createParent.parent;
      expect(data.childrenByParentId.nodes).toHaveLength(2);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
    },
  }),
);

test(
  'setting @name on relation does not affect field names, but changes type names',
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
      comment on constraint child_parent_fkey on p.child is E'@name parentChildRelation';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  create: [{
                    name: "child 1 of test f1"
                  }, {
                    name: "child 2 of test f1"
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

      const data = result.data.createParent.parent;
      expect(data.childrenByParentId.nodes).toHaveLength(2);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
    },
  }),
);

test(
  'setting @forwardMutationName changes field name',
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
      comment on constraint child_parent_fkey on p.child is E'@forwardMutationName susan';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createChild (
            input: {
              child: {
                name: "child 1"
                susan: {
                  create: {
                    name: "parent 1"
                  }
                }
              }
            }
          ) {
            child {
              id
              parentId
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

      const data = result.data.createChild.child;
      expect(data.parentByParentId.id).toEqual(data.parentId);
    },
  }),
);

test(
  'setting @fieldName changes field name',
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
      comment on constraint child_parent_fkey on p.child is E'@fieldName susan';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createChild (
            input: {
              child: {
                name: "child 1"
                susan: {
                  create: {
                    name: "parent 1"
                  }
                }
              }
            }
          ) {
            child {
              id
              parentId
              name
              susan {
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

      const data = result.data.createChild.child;
      expect(data.susan.id).toEqual(data.parentId);
    },
  }),
);

test(
  'setting @reverseMutationName changes field name',
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
      comment on constraint child_parent_fkey on p.child is E'@reverseMutationName jane';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                jane: {
                  create: [{
                    name: "child 1 of test f1"
                  }, {
                    name: "child 2 of test f1"
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

      const data = result.data.createParent.parent;
      expect(data.childrenByParentId.nodes).toHaveLength(2);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
    },
  }),
);

test(
  'setting @foreignFieldName changes field name',
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
      comment on constraint child_parent_fkey on p.child is E'@foreignFieldName jane';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                jane: {
                  create: [{
                    name: "child 1 of test f1"
                  }, {
                    name: "child 2 of test f1"
                  }]
                }
              }
            }
          ) {
            parent {
              id
              name
              jane {
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

      const data = result.data.createParent.parent;
      expect(data.jane.nodes).toHaveLength(2);
      data.jane.nodes.map((n) => expect(n.parentId).toBe(data.id));
    },
  }),
);

test(
  'unreadable foreign table inhibits nested mutation',
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
      comment on table p.child is E'@omit read,update,create,delete,all,many';
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  create: [{
                    name: "child 1 of test f1"
                  }, {
                    name: "child 2 of test f1"
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
        /"childrenUsingId" is not defined/,
      );
    },
  }),
);
