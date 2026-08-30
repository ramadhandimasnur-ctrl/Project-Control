-- Most published analyses name their resources without coding them: 590 of
-- 16.136 lines in the national library carry a code. Requiring one would have
-- refused 96% of the library at the door.
ALTER TABLE ahsp_library_items ALTER COLUMN resource_code DROP NOT NULL;
