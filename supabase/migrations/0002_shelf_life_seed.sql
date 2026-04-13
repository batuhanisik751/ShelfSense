-- ============================================================
-- 0002_shelf_life_seed.sql — Shelf-life rule defaults
-- Conservative USDA-style baselines. Phase 2 shelf-life-researcher
-- will refine these values with more precise research.
-- ============================================================

insert into public.shelf_life_rules (category, default_days, storage) values
  ('dairy',           7,    'fridge'),
  ('eggs',            35,   'fridge'),
  ('raw_poultry',     2,    'fridge'),
  ('raw_red_meat',    3,    'fridge'),
  ('fish',            2,    'fridge'),
  ('leafy_greens',    5,    'fridge'),
  ('fruit',           7,    'fridge'),
  ('root_vegetable',  21,   'pantry'),
  ('bread',           7,    'pantry'),
  ('pasta_dry',       730,  'pantry'),
  ('rice_dry',        730,  'pantry'),
  ('canned',          730,  'pantry'),
  ('frozen',          90,   'freezer'),
  ('condiment',       180,  'fridge'),
  ('cheese_hard',     42,   'fridge'),
  ('cheese_soft',     14,   'fridge'),
  ('deli_meat',       5,    'fridge'),
  ('juice',           10,   'fridge'),
  ('tofu',            5,    'fridge'),
  ('eggs_boiled',     7,    'fridge')
on conflict (category) do nothing;
