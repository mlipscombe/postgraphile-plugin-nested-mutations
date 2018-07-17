[![Package on npm](https://img.shields.io/npm/v/postgraphile-plugin-nested-mutations.svg) (https://www.npmjs.com/package/postgraphile-plugin-nested-mutations) [![CircleCI](https://circleci.com/gh/mlipscombe/postgraphile-plugin-nested-mutations/tree/master.svg?style=svg)](https://circleci.com/gh/mlipscombe/postgraphile-plugin-nested-mutations/tree/master)

# postgraphile-plugin-nested-mutations
This plugin implements nested mutations based on both forward and reverse foreign
key relationships in PostGraphile v4.  Nested mutations can be of infinite depth.

## Breaking Changes

### v1.0.0-alpha.7

Relationships using composite keys are now supported, and this has meant creating
a custom field name for the nested mutation, rather than piggybacking an existing ID
field.  See the examples below for the new GraphQL schema that is generated.

## Warning
This is *alpha quality* software.  It has not undergone significant testing and 
the following features are not yet implemented:

 * `connect` on reverse relationships (i.e. updating an existing row to connect to a new one);
 * nested mutations on any mutations other than `create` mutations.

## Getting Started

### CLI

``` bash
postgraphile --append-plugins postgraphile-plugin-nested-mutations
```

See [here](https://www.graphile.org/postgraphile/extending/#loading-additional-plugins) for
more information about loading plugins with PostGraphile.

### Library

``` js
const express = require('express');
const { postgraphile } = require('postgraphile');
const PostGraphileNestedMutations = require('postgraphile-plugin-nested-mutations');

const app = express();

app.use(
  postgraphile(pgConfig, schema, {
    appendPlugins: [
      PostGraphileNestedMutations,
    ],
  })
);

app.listen(5000);
```

## Example Usage

This plugin creates an additional field on each GraphQL `Input` type for every forward
and reverse foreign key relationship on a table, with the same name as the foreign table.

``` sql
create table parent (
  id serial primary key,
  name text not null
);

create table child (
  id serial primary key,
  parent_id integer,
  name text not null,
  constraint child_parent_fkey foreign key (parent_id)
    references p.parent (id)
);
```

This schema will result in a GraphQL input type that looks like this:

``` graphql
input ParentInput {
  id: Int
  name: String!
  childrenUsingId: ChildParentFkeyInverseInput
}

input ChildInput {
  id: Int
  name: String!
  parentId: Int
  parentToParentId: ChildParentFkeyInput
}

input ChildParentFkeyInput {
  connect: ChildParentFkeyParentConnectInput
  create: ChildParentFkeyParentCreateInput
}

input ChildParentFkeyParentConnectInput {
  id: Int
}

input ChildParentFkeyParentCreateInput {
  id: Int
  name: String!
  childrenUsingId: ChildParentFkeyInverseInput
}

input ChildParentFkeyInverseInput {
  connect: [ChildParentFkeyChildConnectInput!]
  create: [ChildParentFkeyChildCreateInput!]
}

input ChildParentFkeyChildConnectInput {
  id: Int
}

input ChildParentFkeyChildCreateInput {
  id: Int
  name: String!
  parentToParentId: ChildParentFkeyInput
}
```

A nested mutation against this schema, using `Parent` as the base mutation
would look like this:

``` graphql
mutation {
  createParent(input: {
    parent: {
      name: "Parent 1"
      childrenUsingId: {
        create: [{
          name: "Child 1"
        }, {
          name: "Child 2"
        }]
      }
    }
  }) {
    parent {
      id
      name
      childrenByParentId {
        nodes {
          id
          name
        }
      }
    }
  }
}
```

Or using `Child` as the base mutation:

``` graphql
mutation {
  createChild(input: {
    child: {
      name: "Child 1"
      parentToParentId: {
        create: {
          name: "Parent of Child 1"
        }
      }
    },
  }) {
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
```

## Smart Comments

[Smart comments|https://www.graphile.org/postgraphile/smart-comments/] are supported for 
renaming the nested mutation fields.

```sql
comment on constraint child_parent_fkey on child is
  E'@forwardMutationName parent\n@reverseMutationName children';
```
