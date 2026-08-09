DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yu_inventory_runtime') THEN
    CREATE ROLE yu_inventory_runtime LOGIN PASSWORD 'local-runtime-password';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE yu_inventory_dev TO yu_inventory_runtime;
