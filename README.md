[![Package on npm](https://img.shields.io/npm/v/postgraphile-plugin-nested-mutations.svg)](https://www.npmjs.com/package/postgraphile-plugin-nested-mutations)

# postgraphile-plugin-nested-mutations
This plugin implements nested mutations based on both forward and reverse foreign
key relationships in PostGraphile v4.  Nested mutations can be of infinite depth.

## Warning
This is *alpha quality* software.  It has not undergone significant testing and 
does not support "connecting" reverse relationships yet.

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
CREATE TABLE contact (
    id serial primary key,
    name text not null
);

CREATE TABLE contact_email (
    id serial primary key,
    contact_id integer not null,
    email text not null,
    constraint contact_email_contact_fkey foreign key (contact_id)
        references contact (id)
);
```

This schema will result in a GraphQL input type that looks like this:

``` graphql
type ContactInput {
    id: Int!
    name: String!
    contactEmails: ContactEmailContactFkeyInverseInput
}

type ContactBaseInput {
    id: Int
    name: String
}

type ContactEmailInput {
    id: Int!
    contactId: ContactEmailContactFkeyInput!
    email: String!
}

type ContactEmailInput {
    id: Int
    contactId: Int
    email: String
}

type ContactEmailContactFkeyInput {
    connect: Int
    create: ContactBaseInput
}

type ContactEmailContactFkeyInverseInput {
    connect: [Int!]
    create: [ContactEmailBaseInput!]
}
```

A nested mutation against this schema, using `Contact` as the base mutation
would look like this:

``` graphql
mutation {
    createContact(input: {
        contact: {
            name: "John Smith"
            contactEmails: {
                create: [{
                    email: "john@example.com"
                }, {
                    email: "john2@example.com"
                }]
            }
        }
    }) {
        contact {
            id
            name
            contactEmailsByContactId {
                nodes {
                    id
                    email
                }
            }
        }
    }
}
```

Or using `ContactEmail` as the base mutation:

``` graphql
mutation {
    createContactEmail(input: {
        contactEmail: {
            contactId: {
                create: {
                    name: "John Smith"
                }
            }
        },
        email: "john@example.com"
    }) {
        contactEmail {
            id
            email
            contactByContactId {
                id
                name
            }
        }
    }
}
```
