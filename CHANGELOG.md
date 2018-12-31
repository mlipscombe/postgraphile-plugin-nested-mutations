# Changes

## v1.0.0-alpha.11

 * *BREAKING* One-to-one relationships are now correctly named in the singular.  To
   keep using the old behaviour, use the `nestedMutationsOldUniqueFields` option.
 * *BREAKING* The `connect` field has been removed.  In its place is `connectByNodeId`
   which takes a nodeId, and `connnectBy<PK Fields>` for the table's primary key and
   each unique key.
 * Nested mutations on update mutations are now supported.
 * Existing rows can be now be `connected`.
 * Multiple actions per nested type may now be specified (i.e. create some records
   and connect others).
 * A new field has been added on nested mutations: `deleteOthers`.  When set to `true`,
   any related rows not updated or created in the nested mutation will be deleted.  To
   keep a row that is not being created or updated, specify it for update with no 
   modified fields.
 * Relationships between two tables that have multiple relationships are now supported.
   Previously, the last constraint would overwrite the others.  These will usually end 
   up with some pretty awkward names, so the use of smart comments to name the relationships
   is recommended.
 * Improved test suite.

## v1.0.0-alpha.7

Relationships using composite keys are now supported, and this has meant creating
a custom field name for the nested mutation, rather than piggybacking an existing ID
field.  See the examples below for the new GraphQL schema that is generated.
