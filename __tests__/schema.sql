create extension if not exists "uuid-ossp";
drop schema if exists p cascade;

create schema p;

/* create table p.child_no_pk (
  parent_id integer,
  name text not null,
  constraint child_no_pk_parent_fkey foreign key (parent_id)
    references p.parent (id)
); */
