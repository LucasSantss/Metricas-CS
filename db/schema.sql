-- Termômetro Operacional — schema do Neon
-- Rode isso uma vez no SQL editor do Neon (ou via psql) para criar as tabelas.
-- É idempotente: pode rodar de novo sem quebrar nada.

CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY DEFAULT 1,
  chatbot_url TEXT,
  bearer_token TEXT,
  use_business_hours BOOLEAN NOT NULL DEFAULT false,
  get_current BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  department_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  goal_tme_seconds INT NOT NULL DEFAULT 300,
  goal_tma_seconds INT NOT NULL DEFAULT 3600,
  goal_tmr_seconds INT NOT NULL DEFAULT 300,
  goal_csat NUMERIC(3,2) NOT NULL DEFAULT 4.6,
  attendant_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS attendant_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS get_current BOOLEAN NOT NULL DEFAULT false;
-- metas de SLA de resolução dos tickets, por prioridade (em minutos)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_sla_p0_minutes INT NOT NULL DEFAULT 720;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_sla_p1_minutes INT NOT NULL DEFAULT 1440;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_sla_p2_minutes INT NOT NULL DEFAULT 2880;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_sla_p3_minutes INT NOT NULL DEFAULT 10080;

INSERT INTO app_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
