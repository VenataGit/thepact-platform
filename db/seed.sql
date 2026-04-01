-- Seed: Default boards and columns for ThePact video production pipeline

INSERT INTO boards (title, position) VALUES
    ('Pre-Production', 0),
    ('Production', 1),
    ('Post-Production', 2),
    ('Акаунт Мениджмънт', 3),
    ('Задачи', 4)
ON CONFLICT DO NOTHING;

-- Pre-Production columns
INSERT INTO columns (board_id, title, position) VALUES
    ((SELECT id FROM boards WHERE title = 'Pre-Production'), 'Измисляне', 0),
    ((SELECT id FROM boards WHERE title = 'Pre-Production'), 'Преглед', 1),
    ((SELECT id FROM boards WHERE title = 'Pre-Production'), 'Към Клиент', 2),
    ((SELECT id FROM boards WHERE title = 'Pre-Production'), 'Одобрени', 3),
    ((SELECT id FROM boards WHERE title = 'Pre-Production'), 'В продукция', 4);

-- Production columns
INSERT INTO columns (board_id, title, position, is_done_column) VALUES
    ((SELECT id FROM boards WHERE title = 'Production'), 'Разпределение', 0, FALSE),
    ((SELECT id FROM boards WHERE title = 'Production'), 'Заснемане', 1, FALSE),
    ((SELECT id FROM boards WHERE title = 'Production'), 'Монтаж', 2, FALSE),
    ((SELECT id FROM boards WHERE title = 'Production'), 'Преглед', 3, FALSE),
    ((SELECT id FROM boards WHERE title = 'Production'), 'Done', 4, TRUE);

-- Post-Production columns
INSERT INTO columns (board_id, title, position, is_done_column) VALUES
    ((SELECT id FROM boards WHERE title = 'Post-Production'), 'Корекции', 0, FALSE),
    ((SELECT id FROM boards WHERE title = 'Post-Production'), 'Финализиране', 1, FALSE),
    ((SELECT id FROM boards WHERE title = 'Post-Production'), 'Done', 2, TRUE);

-- Акаунт Мениджмънт columns
INSERT INTO columns (board_id, title, position, is_done_column) VALUES
    ((SELECT id FROM boards WHERE title = 'Акаунт Мениджмънт'), 'Разпределение', 0, FALSE),
    ((SELECT id FROM boards WHERE title = 'Акаунт Мениджмънт'), 'Към Клиент', 1, FALSE),
    ((SELECT id FROM boards WHERE title = 'Акаунт Мениджмънт'), 'Качване/Насрочване', 2, FALSE),
    ((SELECT id FROM boards WHERE title = 'Акаунт Мениджмънт'), 'Изчакване', 3, FALSE),
    ((SELECT id FROM boards WHERE title = 'Акаунт Мениджмънт'), 'Done', 4, TRUE);

-- Задачи columns
INSERT INTO columns (board_id, title, position, is_done_column) VALUES
    ((SELECT id FROM boards WHERE title = 'Задачи'), 'За правене', 0, FALSE),
    ((SELECT id FROM boards WHERE title = 'Задачи'), 'В процес', 1, FALSE),
    ((SELECT id FROM boards WHERE title = 'Задачи'), 'Done', 2, TRUE);
