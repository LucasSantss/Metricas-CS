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
  /** Metas de SLA de resolução dos tickets, em horas, por prioridade (tela "Painel de tickets") */
  ticketSlaHours: TicketSlaHours;
};

export type TicketSlaHours = { P0: number; P1: number; P2: number; P3: number };
export const DEFAULT_TICKET_SLA_HOURS: TicketSlaHours = { P0: 12, P1: 24, P2: 48, P3: 168 };

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
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_sla_p0_minutes INT NOT NULL DEFAULT 720
  `;
  await sql`
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_sla_p1_minutes INT NOT NULL DEFAULT 1440
  `;
  await sql`
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_sla_p2_minutes INT NOT NULL DEFAULT 2880
  `;
  await sql`
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ticket_sla_p3_minutes INT NOT NULL DEFAULT 10080
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ticket_reports (
      week_start DATE PRIMARY KEY,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      data JSONB NOT NULL,
      ai JSONB,
      ai_error TEXT,
      model TEXT
    )
  `;
  await sql`
    ALTER TABLE ticket_reports ADD COLUMN IF NOT EXISTS ai_input_hash TEXT
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ticket_reports_ka (LIKE ticket_reports INCLUDING ALL)
  `;
  // Tickets resolvidos na semana (/resolvidos): resumo e categoria da IA por ticket, e a visão geral por semana e recorte
  await sql`
    CREATE TABLE IF NOT EXISTS ticket_summaries (
      ticket_id TEXT PRIMARY KEY,
      input_hash TEXT NOT NULL,
      resumo TEXT NOT NULL,
      categoria TEXT NOT NULL,
      model TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS resolved_overviews (
      week_start DATE NOT NULL,
      segment TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      partial BOOLEAN NOT NULL DEFAULT false,
      ticket_count INT NOT NULL DEFAULT 0,
      ai JSONB,
      ai_error TEXT,
      model TEXT,
      ai_input_hash TEXT,
      PRIMARY KEY (week_start, segment)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS admins (
      email TEXT PRIMARY KEY,
      added_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
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
  const rows = await sql`SELECT chatbot_url, bearer_token, use_business_hours, get_current,
    ticket_sla_p0_minutes, ticket_sla_p1_minutes, ticket_sla_p2_minutes, ticket_sla_p3_minutes
    FROM app_settings WHERE id = 1`;
  const row = rows[0] as any;
  return {
    chatbotUrl: connectionLocked ? envUrl : row?.chatbot_url ?? null,
    bearerToken: connectionLocked ? envToken : row?.bearer_token ?? null,
    useBusinessHours: row?.use_business_hours ?? false,
    getCurrent: row?.get_current ?? false,
    connectionLocked,
    ticketSlaHours: {
      P0: row?.ticket_sla_p0_minutes != null ? row.ticket_sla_p0_minutes / 60 : DEFAULT_TICKET_SLA_HOURS.P0,
      P1: row?.ticket_sla_p1_minutes != null ? row.ticket_sla_p1_minutes / 60 : DEFAULT_TICKET_SLA_HOURS.P1,
      P2: row?.ticket_sla_p2_minutes != null ? row.ticket_sla_p2_minutes / 60 : DEFAULT_TICKET_SLA_HOURS.P2,
      P3: row?.ticket_sla_p3_minutes != null ? row.ticket_sla_p3_minutes / 60 : DEFAULT_TICKET_SLA_HOURS.P3,
    },
  };
}

export async function saveSettings(input: {
  chatbotUrl?: string;
  bearerToken?: string;
  useBusinessHours?: boolean;
  getCurrent?: boolean;
  ticketSlaHours?: Partial<TicketSlaHours>;
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
  const sla = { ...current.ticketSlaHours, ...input.ticketSlaHours };
  const toMin = (h: number) => Math.round(h * 60);
  await sql`
    UPDATE app_settings
    SET chatbot_url = ${chatbotUrl},
        bearer_token = ${bearerToken},
        use_business_hours = ${useBusinessHours},
        get_current = ${getCurrent},
        ticket_sla_p0_minutes = ${toMin(sla.P0)},
        ticket_sla_p1_minutes = ${toMin(sla.P1)},
        ticket_sla_p2_minutes = ${toMin(sla.P2)},
        ticket_sla_p3_minutes = ${toMin(sla.P3)},
        updated_at = now()
    WHERE id = 1
  `;
}

function mapDepartment(row: any): Department {
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

/* ---------- Relatório de tickets (um por semana e por recorte) ---------- */

/** "all" = base inteira; "ka" = só clientes do grupo /ka do SoftCS Bot. */
export type ReportSegment = "all" | "ka";

// Nome de tabela não pode ir como parâmetro; só estes dois valores fixos chegam nas consultas.
const reportTable = (segment: ReportSegment) => (segment === "ka" ? "ticket_reports_ka" : "ticket_reports");

export type TicketReportRow = {
  weekStart: string; // "YYYY-MM-DD", segunda-feira
  generatedAt: string;
  data: unknown;
  ai: unknown | null;
  aiError: string | null;
  model: string | null;
  /** impressão digital do que foi mandado pra IA — igual = texto reaproveitado sem nova chamada */
  aiInputHash: string | null;
};

export async function saveTicketReport(
  r: {
    weekStart: string;
    data: unknown;
    ai: unknown | null;
    aiError: string | null;
    model: string | null;
    aiInputHash: string | null;
  },
  segment: ReportSegment = "all"
) {
  const sql = getSql();
  await ensureSchema();
  await sql(
    `INSERT INTO ${reportTable(segment)} (week_start, generated_at, data, ai, ai_error, model, ai_input_hash)
     VALUES ($1, now(), $2::jsonb, $3::jsonb, $4, $5, $6)
     ON CONFLICT (week_start) DO UPDATE SET
       generated_at = now(), data = EXCLUDED.data, ai = EXCLUDED.ai, ai_error = EXCLUDED.ai_error,
       model = EXCLUDED.model, ai_input_hash = EXCLUDED.ai_input_hash`,
    [r.weekStart, JSON.stringify(r.data), r.ai == null ? null : JSON.stringify(r.ai), r.aiError, r.model, r.aiInputHash]
  );
}

export async function getTicketReport(weekStart: string, segment: ReportSegment = "all"): Promise<TicketReportRow | null> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql(
    `SELECT week_start::text AS week_start, generated_at, data, ai, ai_error, model, ai_input_hash
     FROM ${reportTable(segment)} WHERE week_start = $1`,
    [weekStart]
  );
  const row = rows[0] as any;
  if (!row) return null;
  return {
    weekStart: row.week_start,
    generatedAt: new Date(row.generated_at).toISOString(),
    data: row.data,
    ai: row.ai,
    aiError: row.ai_error,
    model: row.model,
    aiInputHash: row.ai_input_hash ?? null,
  };
}

/** Semanas com relatório gerado, da mais recente pra mais antiga (sem o conteúdo). */
export async function listTicketReports(segment: ReportSegment = "all"): Promise<{ weekStart: string; generatedAt: string; hasAi: boolean }[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql(
    `SELECT week_start::text AS week_start, generated_at, ai IS NOT NULL AS has_ai
     FROM ${reportTable(segment)} ORDER BY week_start DESC LIMIT 104`
  );
  return (rows as any[]).map((r: any) => ({ weekStart: r.week_start, generatedAt: new Date(r.generated_at).toISOString(), hasAi: r.has_ai }));
}

// Administradores (lib/admin.ts): além do administrador fixo, os e-mails adicionados pela tela de Ajustes
export type AdminRow = { email: string; addedBy: string | null; createdAt: string };

export async function listAdminRows(): Promise<AdminRow[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`SELECT email, added_by, created_at FROM admins ORDER BY created_at`;
  return (rows as any[]).map((r) => ({ email: r.email, addedBy: r.added_by, createdAt: new Date(r.created_at).toISOString() }));
}

export async function isAdminRow(email: string): Promise<boolean> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`SELECT 1 FROM admins WHERE email = ${email.toLowerCase()}`;
  return rows.length > 0;
}

export async function insertAdmin(email: string, addedBy: string) {
  const sql = getSql();
  await ensureSchema();
  await sql`INSERT INTO admins (email, added_by) VALUES (${email.toLowerCase()}, ${addedBy}) ON CONFLICT (email) DO NOTHING`;
}

export async function deleteAdmin(email: string) {
  const sql = getSql();
  await ensureSchema();
  await sql`DELETE FROM admins WHERE email = ${email.toLowerCase()}`;
}

/* ---------- tickets resolvidos na semana (/resolvidos) ---------- */

export type TicketSummaryRow = { ticketId: string; inputHash: string; resumo: string; categoria: string; model: string | null };

export async function getTicketSummaries(ids: string[]): Promise<Map<string, TicketSummaryRow>> {
  if (!ids.length) return new Map();
  const sql = getSql();
  await ensureSchema();
  const rows = await sql(`SELECT ticket_id, input_hash, resumo, categoria, model FROM ticket_summaries WHERE ticket_id = ANY($1::text[])`, [ids]);
  return new Map(
    (rows as any[]).map((r) => [r.ticket_id, { ticketId: r.ticket_id, inputHash: r.input_hash, resumo: r.resumo, categoria: r.categoria, model: r.model }])
  );
}

export async function saveTicketSummaries(items: TicketSummaryRow[]) {
  if (!items.length) return;
  const sql = getSql();
  await ensureSchema();
  await sql(
    `INSERT INTO ticket_summaries (ticket_id, input_hash, resumo, categoria, model, updated_at)
     SELECT *, now() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
     ON CONFLICT (ticket_id) DO UPDATE SET
       input_hash = EXCLUDED.input_hash, resumo = EXCLUDED.resumo, categoria = EXCLUDED.categoria,
       model = EXCLUDED.model, updated_at = now()`,
    [items.map((i) => i.ticketId), items.map((i) => i.inputHash), items.map((i) => i.resumo), items.map((i) => i.categoria), items.map((i) => i.model)]
  );
}

/** Categorias já usadas, das mais frequentes pras menos — a IA reaproveita os nomes. */
export async function listSummaryCategories(limit = 40): Promise<string[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql(`SELECT categoria FROM ticket_summaries GROUP BY categoria ORDER BY count(*) DESC LIMIT $1`, [limit]);
  return (rows as any[]).map((r) => r.categoria);
}

export type ResolvedOverviewRow = {
  weekStart: string;
  segment: string;
  generatedAt: string;
  partial: boolean;
  ticketCount: number;
  ai: unknown | null;
  aiError: string | null;
  model: string | null;
  aiInputHash: string | null;
};

export async function getResolvedOverviews(weekStart: string): Promise<ResolvedOverviewRow[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql(
    `SELECT week_start::text AS week_start, segment, generated_at, partial, ticket_count, ai, ai_error, model, ai_input_hash
     FROM resolved_overviews WHERE week_start = $1`,
    [weekStart]
  );
  return (rows as any[]).map((r) => ({
    weekStart: r.week_start,
    segment: r.segment,
    generatedAt: new Date(r.generated_at).toISOString(),
    partial: r.partial,
    ticketCount: r.ticket_count,
    ai: r.ai,
    aiError: r.ai_error,
    model: r.model,
    aiInputHash: r.ai_input_hash ?? null,
  }));
}

export async function saveResolvedOverview(r: Omit<ResolvedOverviewRow, "generatedAt">) {
  const sql = getSql();
  await ensureSchema();
  await sql(
    `INSERT INTO resolved_overviews (week_start, segment, generated_at, partial, ticket_count, ai, ai_error, model, ai_input_hash)
     VALUES ($1, $2, now(), $3, $4, $5::jsonb, $6, $7, $8)
     ON CONFLICT (week_start, segment) DO UPDATE SET
       generated_at = now(), partial = EXCLUDED.partial, ticket_count = EXCLUDED.ticket_count, ai = EXCLUDED.ai,
       ai_error = EXCLUDED.ai_error, model = EXCLUDED.model, ai_input_hash = EXCLUDED.ai_input_hash`,
    [r.weekStart, r.segment, r.partial, r.ticketCount, r.ai == null ? null : JSON.stringify(r.ai), r.aiError, r.model, r.aiInputHash]
  );
}
