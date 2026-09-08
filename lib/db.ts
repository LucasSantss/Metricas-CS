import { neon } from "@neondatabase/serverless";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não configurada. Defina a variável de ambiente com a connection string do Neon."
    );
  }
  return neon(url);
}

export type AppSettings = {
  chatbotUrl: string | null;
  bearerToken: string | null;
  useBusinessHours: boolean;
  /** Inclui atendimentos ainda em andamento (getCurrent na API Suri) */
  getCurrent: boolean;
  /** true quando URL/token vêm de env var (SURI_CHATBOT_URL/SURI_BEARER_TOKEN) e não podem ser editados pela UI */
  connectionLocked: boolean;
};

export type KnownAttendant = { id: string; name: string };

export type Department = {
  id: number;
  departmentId: string;
  name: string;
  active: boolean;
  sortOrder: number;
  goalTmeSeconds: number;
  goalTmaSeconds: number;
  goalTmrSeconds: number;
  goalCsat: number;
  /** metas de percentil (P50/P75/P90), em segundos — usadas na tela de Percentis operacionais */
  goalTmeP50Seconds: number;
  goalTmeP75Seconds: number;
  goalTmeP90Seconds: number;
  goalTmaP50Seconds: number;
  goalTmaP75Seconds: number;
  goalTmaP90Seconds: number;
  goalTmrP50Seconds: number;
  goalTmrP75Seconds: number;
  goalTmrP90Seconds: number;
  /** subconjunto de attendantId da API Suri; vazio = considera todos os atendentes do setor */
  attendantIds: string[];
  /** atendentes vistos no histórico de /api/attendances deste setor (id + nome) */
  knownAttendants: KnownAttendant[];
};

export async function ensureSchema() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INT PRIMARY KEY DEFAULT 1,
      chatbot_url TEXT,
      bearer_token TEXT,
      use_business_hours BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT single_row CHECK (id = 1)
    )
  `;
  await sql`
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS attendant_ids TEXT[] NOT NULL DEFAULT '{}'
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS known_attendants JSONB NOT NULL DEFAULT '[]'
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tme_p50_seconds INT NOT NULL DEFAULT 300
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tme_p75_seconds INT NOT NULL DEFAULT 450
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tme_p90_seconds INT NOT NULL DEFAULT 600
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tma_p50_seconds INT NOT NULL DEFAULT 3600
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tma_p75_seconds INT NOT NULL DEFAULT 5400
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tma_p90_seconds INT NOT NULL DEFAULT 7200
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tmr_p50_seconds INT NOT NULL DEFAULT 300
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tmr_p75_seconds INT NOT NULL DEFAULT 450
  `;
  await sql`
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS goal_tmr_p90_seconds INT NOT NULL DEFAULT 600
  `;
  await sql`
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS get_current BOOLEAN NOT NULL DEFAULT false
  `;
  await sql`
    INSERT INTO app_settings (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function getSettings(): Promise<AppSettings> {
  const envUrl = process.env.SURI_CHATBOT_URL?.trim() || null;
  const envToken = process.env.SURI_BEARER_TOKEN?.trim() || null;
  const connectionLocked = Boolean(envUrl && envToken);

  const sql = getSql();
  await ensureSchema();
  const rows = await sql`SELECT chatbot_url, bearer_token, use_business_hours, get_current FROM app_settings WHERE id = 1`;
  const row = rows[0] as any;
  return {
    chatbotUrl: connectionLocked ? envUrl : row?.chatbot_url ?? null,
    bearerToken: connectionLocked ? envToken : row?.bearer_token ?? null,
    useBusinessHours: row?.use_business_hours ?? false,
    getCurrent: row?.get_current ?? false,
    connectionLocked,
  };
}

export async function saveSettings(input: {
  chatbotUrl?: string;
  bearerToken?: string;
  useBusinessHours?: boolean;
  getCurrent?: boolean;
}) {
  const sql = getSql();
  await ensureSchema();
  const current = await getSettings();
  // Quando a conexão vem de env var (SURI_CHATBOT_URL/SURI_BEARER_TOKEN), ela é fixa —
  // ignora qualquer chatbotUrl/bearerToken vindo da UI e nunca sobrescreve o banco com eles.
  const chatbotUrl = current.connectionLocked ? current.chatbotUrl : input.chatbotUrl ?? current.chatbotUrl;
  const bearerToken = current.connectionLocked ? current.bearerToken : input.bearerToken ?? current.bearerToken;
  const useBusinessHours = input.useBusinessHours ?? current.useBusinessHours;
  const getCurrent = input.getCurrent ?? current.getCurrent;
  await sql`
    UPDATE app_settings
    SET chatbot_url = ${chatbotUrl},
        bearer_token = ${bearerToken},
        use_business_hours = ${useBusinessHours},
        get_current = ${getCurrent},
        updated_at = now()
    WHERE id = 1
  `;
}

function mapDepartment(row: any): Department {
  let knownAttendants: KnownAttendant[] = [];
  if (Array.isArray(row.known_attendants)) {
    knownAttendants = row.known_attendants;
  } else if (typeof row.known_attendants === "string") {
    try {
      knownAttendants = JSON.parse(row.known_attendants);
    } catch {
      knownAttendants = [];
    }
  }
  return {
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    active: row.active,
    sortOrder: row.sort_order,
    goalTmeSeconds: row.goal_tme_seconds,
    goalTmaSeconds: row.goal_tma_seconds,
    goalTmrSeconds: row.goal_tmr_seconds,
    goalCsat: Number(row.goal_csat),
    goalTmeP50Seconds: row.goal_tme_p50_seconds,
    goalTmeP75Seconds: row.goal_tme_p75_seconds,
    goalTmeP90Seconds: row.goal_tme_p90_seconds,
    goalTmaP50Seconds: row.goal_tma_p50_seconds,
    goalTmaP75Seconds: row.goal_tma_p75_seconds,
    goalTmaP90Seconds: row.goal_tma_p90_seconds,
    goalTmrP50Seconds: row.goal_tmr_p50_seconds,
    goalTmrP75Seconds: row.goal_tmr_p75_seconds,
    goalTmrP90Seconds: row.goal_tmr_p90_seconds,
    attendantIds: row.attendant_ids ?? [],
    knownAttendants,
  };
}

export async function listDepartments(): Promise<Department[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`SELECT * FROM departments ORDER BY sort_order ASC, name ASC`;
  return rows.map(mapDepartment);
}

export async function upsertDepartment(input: {
  departmentId: string;
  name: string;
  active?: boolean;
  sortOrder?: number;
  goalTmeSeconds?: number;
  goalTmaSeconds?: number;
  goalTmrSeconds?: number;
  goalCsat?: number;
  goalTmeP50Seconds?: number;
  goalTmeP75Seconds?: number;
  goalTmeP90Seconds?: number;
  goalTmaP50Seconds?: number;
  goalTmaP75Seconds?: number;
  goalTmaP90Seconds?: number;
  goalTmrP50Seconds?: number;
  goalTmrP75Seconds?: number;
  goalTmrP90Seconds?: number;
  attendantIds?: string[];
}) {
  const sql = getSql();
  await ensureSchema();
  const active = input.active ?? null;
  const sortOrder = input.sortOrder ?? null;
  const goalTmeSeconds = input.goalTmeSeconds ?? null;
  const goalTmaSeconds = input.goalTmaSeconds ?? null;
  const goalTmrSeconds = input.goalTmrSeconds ?? null;
  const goalCsat = input.goalCsat ?? null;
  const goalTmeP50Seconds = input.goalTmeP50Seconds ?? null;
  const goalTmeP75Seconds = input.goalTmeP75Seconds ?? null;
  const goalTmeP90Seconds = input.goalTmeP90Seconds ?? null;
  const goalTmaP50Seconds = input.goalTmaP50Seconds ?? null;
  const goalTmaP75Seconds = input.goalTmaP75Seconds ?? null;
  const goalTmaP90Seconds = input.goalTmaP90Seconds ?? null;
  const goalTmrP50Seconds = input.goalTmrP50Seconds ?? null;
  const goalTmrP75Seconds = input.goalTmrP75Seconds ?? null;
  const goalTmrP90Seconds = input.goalTmrP90Seconds ?? null;
  const attendantIds = input.attendantIds ?? null;
  const rows = await sql`
    INSERT INTO departments (
      department_id, name, active, sort_order,
      goal_tme_seconds, goal_tma_seconds, goal_tmr_seconds, goal_csat,
      goal_tme_p50_seconds, goal_tme_p75_seconds, goal_tme_p90_seconds,
      goal_tma_p50_seconds, goal_tma_p75_seconds, goal_tma_p90_seconds,
      goal_tmr_p50_seconds, goal_tmr_p75_seconds, goal_tmr_p90_seconds,
      attendant_ids
    ) VALUES (
      ${input.departmentId}, ${input.name}, ${active ?? true}, ${sortOrder ?? 0},
      ${goalTmeSeconds ?? 300}, ${goalTmaSeconds ?? 3600}, ${goalTmrSeconds ?? 300}, ${goalCsat ?? 4.6},
      ${goalTmeP50Seconds ?? 300}, ${goalTmeP75Seconds ?? 450}, ${goalTmeP90Seconds ?? 600},
      ${goalTmaP50Seconds ?? 3600}, ${goalTmaP75Seconds ?? 5400}, ${goalTmaP90Seconds ?? 7200},
      ${goalTmrP50Seconds ?? 300}, ${goalTmrP75Seconds ?? 450}, ${goalTmrP90Seconds ?? 600},
      ${attendantIds ?? []}
    )
    ON CONFLICT (department_id) DO UPDATE SET
      name = EXCLUDED.name,
      active = COALESCE(${active}, departments.active),
      sort_order = COALESCE(${sortOrder}, departments.sort_order),
      goal_tme_seconds = COALESCE(${goalTmeSeconds}, departments.goal_tme_seconds),
      goal_tma_seconds = COALESCE(${goalTmaSeconds}, departments.goal_tma_seconds),
      goal_tmr_seconds = COALESCE(${goalTmrSeconds}, departments.goal_tmr_seconds),
      goal_csat = COALESCE(${goalCsat}, departments.goal_csat),
      goal_tme_p50_seconds = COALESCE(${goalTmeP50Seconds}, departments.goal_tme_p50_seconds),
      goal_tme_p75_seconds = COALESCE(${goalTmeP75Seconds}, departments.goal_tme_p75_seconds),
      goal_tme_p90_seconds = COALESCE(${goalTmeP90Seconds}, departments.goal_tme_p90_seconds),
      goal_tma_p50_seconds = COALESCE(${goalTmaP50Seconds}, departments.goal_tma_p50_seconds),
      goal_tma_p75_seconds = COALESCE(${goalTmaP75Seconds}, departments.goal_tma_p75_seconds),
      goal_tma_p90_seconds = COALESCE(${goalTmaP90Seconds}, departments.goal_tma_p90_seconds),
      goal_tmr_p50_seconds = COALESCE(${goalTmrP50Seconds}, departments.goal_tmr_p50_seconds),
      goal_tmr_p75_seconds = COALESCE(${goalTmrP75Seconds}, departments.goal_tmr_p75_seconds),
      goal_tmr_p90_seconds = COALESCE(${goalTmrP90Seconds}, departments.goal_tmr_p90_seconds),
      attendant_ids = COALESCE(${attendantIds}, departments.attendant_ids)
    RETURNING *
  `;
  return mapDepartment(rows[0]);
}

export async function deleteDepartment(id: number) {
  const sql = getSql();
  await ensureSchema();
  await sql`DELETE FROM departments WHERE id = ${id}`;
}

/** Substitui a lista de atendentes conhecidos de um setor (não mexe no filtro attendant_ids). */
export async function setKnownAttendants(departmentId: string, knownAttendants: KnownAttendant[]) {
  const sql = getSql();
  await ensureSchema();
  await sql`
    UPDATE departments
    SET known_attendants = ${JSON.stringify(knownAttendants)}::jsonb
    WHERE department_id = ${departmentId}
  `;
}
