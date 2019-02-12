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

// https://github.com/mlipscombe/postgraphile-plugin-nested-mutations/issues/7
test(
  '1:1 relationship does not allow multiple nested rows',
  withSchema({
    setup: `
      CREATE TABLE p.post (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL
      );
      
      CREATE TABLE p.post_image (
        id SERIAL PRIMARY KEY,
        post_id INTEGER UNIQUE NOT NULL REFERENCES p.post(id) ON DELETE CASCADE,
        url TEXT NOT NULL
      );
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          c1: createPost(
            input: {
              post: {
                text: "test"
                postImageUsingId: {
                  create: {
                    url: "test child"
                  }
                }
              }
            }
          ) {
            post {
              id
            }
          }

          c2: createPostImage(
            input: {
              postImage: {
                url: "child"
                postToPostId: {
                  create: {
                    text: "child's parent"
                  }
                }
              }
            }
          ) {
            postImage {
              postId
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
  '1:1 relationship mutation fails when multiple operators are specified',
  withSchema({
    setup: `
      CREATE TABLE p.post (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL
      );
      
      CREATE TABLE p.post_image (
        id SERIAL PRIMARY KEY,
        post_id INTEGER UNIQUE NOT NULL REFERENCES p.post(id) ON DELETE CASCADE,
        url TEXT NOT NULL
      );
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        mutation {
          c1: createPost(
            input: {
              post: {
                text: "test"
                postImageUsingId: {
                  create: {
                    url: "test child"
                  }
                  connectById: {
                    id: 1
                  }
                }
              }
            }
          ) {
            post {
              id
            }
          }

          c2: createPostImage(
            input: {
              postImage: {
                url: "child"
                postToPostId: {
                  create: {
                    text: "child's parent"
                  }
                  connectById: {
                    id: 1
                  }
                }
              }
            }
          ) {
            postImage {
              postId
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).toHaveProperty('errors');
      expect(result.errors[0].message).toMatch(
        /may only create or connect a single row/,
      );
    },
  }),
);
