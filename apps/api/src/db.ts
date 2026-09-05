import { Pool, type PoolClient } from "pg";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

const schema = `
CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admins_singleton_idx ON admins ((true));
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  file_hash text NOT NULL UNIQUE,
  source text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid REFERENCES imports(id) ON DELETE SET NULL,
  source text NOT NULL,
  external_id text NOT NULL,
  fingerprint text NOT NULL UNIQUE,
  description text NOT NULL,
  merchant text,
  amount_cents bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  payment_method text NOT NULL DEFAULT 'unknown',
  category text NOT NULL DEFAULT 'Outros',
  raw jsonb NOT NULL DEFAULT '{}',
  merged_into uuid REFERENCES transactions(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS transactions_occurred_at_idx ON transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions(category);
CREATE INDEX IF NOT EXISTS transactions_active_occurred_at_idx ON transactions(occurred_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_whatsapp_external_id_idx ON transactions(source,external_id) WHERE source='whatsapp';
CREATE UNIQUE INDEX IF NOT EXISTS transactions_monthly_salary_idx ON transactions(source,external_id) WHERE source='manual' AND external_id LIKE 'recurring:salary:%';
CREATE TABLE IF NOT EXISTS reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_transaction_id uuid NOT NULL REFERENCES transactions(id),
  secondary_transaction_id uuid NOT NULL REFERENCES transactions(id),
  score integer NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
CREATE TABLE IF NOT EXISTS budgets (
  category text PRIMARY KEY,
  limit_cents bigint NOT NULL,
  month date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  parent_name text REFERENCES categories(name) ON DELETE SET NULL ON UPDATE CASCADE,
  keywords text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_ci_idx ON categories (lower(name));
CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories(parent_name);
INSERT INTO categories(name, keywords, is_system) VALUES
  ('Alimentação', ARRAY['ifood','restaurante','mercado','assai','pao','food','cafe'], true),
  ('Transporte', ARRAY['uber','posto','shell','combustivel','99app'], true),
  ('Lazer', ARRAY['netflix','spotify','prime','cinema','steam'], true),
  ('Saúde', ARRAY['smartfit','academia','farmacia','hospital'], true),
  ('Moradia', ARRAY['aluguel','condominio','energia','internet','agua'], true),
  ('Receitas', ARRAY['salario','freelance','rendimento'], true),
  ('Casa', ARRAY[]::text[], true),
  ('Compras', ARRAY[]::text[], true),
  ('Educação', ARRAY[]::text[], true),
  ('Outros', ARRAY[]::text[], true)
ON CONFLICT (name) DO NOTHING;
CREATE TABLE IF NOT EXISTS goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  target_cents bigint NOT NULL,
  current_cents bigint NOT NULL DEFAULT 0,
  target_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function migrate(): Promise<void> {
  await pool.query(schema);
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
