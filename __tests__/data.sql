insert into p.parent (id, name) values
    (1000, 'A'),
    (1001, 'B'),
    (1002, 'C');

insert into p.child (id, parent_id, name) values
    (100, 1000, 'A');
