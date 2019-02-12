const { graphql } = require('graphql');
const { withSchema } = require('../helpers');

test(
  'table with no relations is not affected by plugin',
  withSchema({
    setup: `
    create table p.parent (
      id serial primary key,
      name text not null
    );`,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
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
  'forward nested mutation creates records',
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
  'forward nested mutation with null nested fields succeeds',
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

      insert into p.child values(1, null, 'test child 1');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  create: null
                  connectById: null
                  updateById: null
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
      expect(data.childrenByParentId.nodes).toHaveLength(0);
    },
  }),
);

test(
  'forward nested mutation with null outer nested field succeeds',
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

      insert into p.child values(6, null, 'test child 1');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          a1: createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: null
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
          a2: createChild(
            input: {
              child: {
                name: "test child 2"
                parentToParentId: null
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
  'forward deeply nested mutation creates records',
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
                    grandchildrenUsingId: {
                      create: [{
                        name: "grandchild 1 of child 1"
                      }]
                    }
                  }, {
                    name: "child 2 of test f1"
                    grandchildrenUsingId: {
                      create: [{
                        name: "grandchild 1 of child 2"
                      }]
                    }
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

      const data = result.data.createParent.parent;
      expect(data.childrenByParentId.nodes).toHaveLength(2);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
    },
  }),
);

test(
  'forward nested mutation connects existing records and creates simultaneously',
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

      insert into p.child values (123, null, 'unattached child');
      insert into p.child values (124, null, 'unattached child');
      insert into p.child values (125, null, 'unattached child');
    `,
    test: async ({ schema, pgClient }) => {
      const lookupQuery = `
        query {
          childById(id: 125) {
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
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  connectById: [{
                    id: 123
                  }, {
                    id: 124
                  }]
                  connectByNodeId: [{
                    nodeId: "${nodeId}"
                  }]
                  create: [{
                    name: "child 1"
                  }, {
                    name: "child 2"
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
      expect(data.childrenByParentId.nodes).toHaveLength(5);
      data.childrenByParentId.nodes.map((n) =>
        expect(n.parentId).toBe(data.id),
      );
    },
  }),
);

test(
  'invalid nodeId fails',
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
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingId: {
                  connectByNodeId: [{
                    nodeId: "W10="
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
      expect(result.errors[0].message).toMatch(/Mismatched type/);
    },
  }),
);

test(
  'reverse nested mutation creates records',
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
          createChild(
            input: {
              child: {
                name: "test f1"
                parentToParentId: {
                  create: {
                    name: "parent of f1"
                  }
                }
              }
            }
          ) {
            child {
              id
              name
              parentId
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
  'reverse nested mutation connects to existing records',
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
      insert into p.parent values (1000, 'parent 1');
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createChild(
            input: {
              child: {
                name: "test f1"
                parentToParentId: {
                  connectById: {
                    id: 1000
                  }
                }
              }
            }
          ) {
            child {
              id
              name
              parentId
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
      expect(data.parentId).toEqual(1000);
      expect(data.parentByParentId.id).toEqual(data.parentId);
    },
  }),
);

test(
  'reverse nested mutation connects by nodeId to existing records',
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
      insert into p.parent values (1000, 'parent 1');
    `,
    test: async ({ schema, pgClient }) => {
      const lookupQuery = `
        query {
          parentById(id: 1000) {
            nodeId
          }
        }
      `;
      const lookupResult = await graphql(schema, lookupQuery, null, {
        pgClient,
      });
      const { nodeId } = lookupResult.data.parentById;
      expect(nodeId).not.toBeUndefined();

      const query = `
        mutation {
          createChild(
            input: {
              child: {
                name: "test f1"
                parentToParentId: {
                  connectByNodeId: {
                    nodeId: "${nodeId}"
                  }
                }
              }
            }
          ) {
            child {
              id
              name
              parentId
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
      expect(data.parentId).toEqual(1000);
      expect(data.parentByParentId.id).toEqual(data.parentId);
    },
  }),
);

test(
  'forward nested mutation using uuid pkey creates records',
  withSchema({
    setup: `
      create table p.parent (
        id uuid not null primary key default uuid_generate_v4(),
        name text not null
      );
      
      create table p.child (
        id uuid not null primary key default uuid_generate_v4(),
        parent_id uuid not null,
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
                id: "0609e1cc-4f01-4c33-a7c0-aee402e9d043"
                name: "test f1"
                childrenUsingId: {
                  create: [{
                    id: "dbb34d5a-c4e1-4b42-9d0d-a3e546f02a94"
                    name: "child 1"
                  }, {
                    id: "d9deb95b-1a69-4178-aa7c-834ed54edb91"
                    name: "child 2"
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
        expect(n.parentId).toEqual(data.id),
      );
    },
  }),
);

test(
  'forward nested mutation using composite pkey creates records',
  withSchema({
    setup: `
      create table p.parent (
        id serial,
        name text not null,
        constraint parent_pkey primary key (id, name)
      );
      
      create table p.child (
        id serial primary key,
        name text not null,
        parent_id integer not null,
        parent_name text not null,
        constraint child_parent_fkey foreign key (parent_id, parent_name)
          references p.parent (id, name)
      );
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                name: "test f1"
                childrenUsingIdAndName: {
                  create: [{
                    name: "child 1"
                  }, {
                    name: "child 2"
                  }]
                }
              }
            }
          ) {
            parent {
              id
              name
              childrenByParentIdAndParentName {
                nodes {
                  id
                  parentId
                  parentName
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
      expect(data.childrenByParentIdAndParentName.nodes).toHaveLength(2);
      data.childrenByParentIdAndParentName.nodes.map((n) =>
        expect([n.parentId, n.parentName]).toEqual([data.id, data.name]),
      );
    },
  }),
);

// https://github.com/mlipscombe/postgraphile-plugin-nested-mutations/issues/1
test(
  'forward nested mutation with composite key on child table creates records',
  withSchema({
    setup: `
      create table p.parent (
        id uuid default uuid_generate_v4(),
        primary key (id)
      );
      
      create table p.child (
        parent_id uuid not null,
        service_id varchar(50) not null,
        name varchar(50) not null,
        val varchar(50) not null,
        primary key (parent_id, service_id, name, val),
        foreign key (parent_id) references p.parent (id)
      );
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createParent(
            input: {
              parent: {
                childrenUsingId: {
                  create: [{
                    name: "child 1 of test f1"
                    serviceId: "test"
                    val: "test"
                  }, {
                    name: "child 2 of test f1"
                    serviceId: "test"
                    val: "test"
                  }]
                }
              }
            }
          ) {
            parent {
              id
              childrenByParentId {
                nodes {
                  parentId
                  serviceId
                  val
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

// https://github.com/mlipscombe/postgraphile-plugin-nested-mutations/issues/9
test(
  'works with multiple fkeys to the same related table',
  withSchema({
    setup: `
    create table p.job (
      id serial primary key
    );
    
    create table p.job_relationship (
      type text,
      from_job_id integer references p.job(id),
      to_job_id integer references p.job(id)
    );
        `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          createJob(
            input: {
              job: {
                jobRelationshipsToToJobIdUsingId: {
                  create: [{
                    type: "test"
                  }]
                }
              }
            }
          ) {
            job {
              id
              jobRelationshipsByToJobId {
                nodes {
                  type
                  toJobId
                  fromJobId
                }
              }
              jobRelationshipsByFromJobId {
                nodes {
                  type
                  toJobId
                  fromJobId
                }
              }
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const data = result.data.createJob.job;
      expect(data.jobRelationshipsByToJobId.nodes).toHaveLength(1);
      expect(data.jobRelationshipsByFromJobId.nodes).toHaveLength(0);
    },
  }),
);
