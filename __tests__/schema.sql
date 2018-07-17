create extension if not exists "uuid-ossp";
drop schema if exists p cascade;

create schema p;

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

create table p.parent_uuid (
  id uuid not null primary key default uuid_generate_v4(),
  name text not null
);

create table p.child_uuid (
  id uuid not null primary key default uuid_generate_v4(),
  parent_id uuid not null,
  name text not null,
  constraint child_uuid_parent_uuid_fkey foreign key (parent_id)
    references p.parent_uuid (id)
);

create table p.named_parent (
  id serial primary key,
  name text not null
);

create table p.named_child (
  id serial primary key,
  parent_id integer,
  name text not null,
  constraint named_child_named_parent_fkey foreign key (parent_id)
    references p.named_parent (id)
);

comment on constraint named_child_named_parent_fkey on p.named_child is 
  E'@name parentChildRelation\n@forwardMutationName parent\n@reverseMutationName children\nThe relationship between parent and child.';

create table p.multi_parent (
  id serial,
  name text not null,
  constraint multi_parent_pkey primary key (id, name)
);

create table p.multi_child (
  id serial primary key,
  name text not null,
  parent_id integer not null,
  parent_name text not null,
  constraint multi_child_multi_parent_fkey foreign key (parent_id, parent_name)
    references p.multi_parent (id, name)
);

create table p.issue_1_parent (
  id uuid default uuid_generate_v4(),
  primary key (id)
);

create table p.issue_1_child (
  parent_id uuid not null,
  service_id varchar(50) not null,
  name varchar(50) not null,
  val varchar(50) not null,
  primary key (parent_id, service_id, name, val),
  foreign key (parent_id) references p.issue_1_parent (id)
);
