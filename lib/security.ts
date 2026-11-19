/**
 * Utilitários de segurança do servidor: mensagem de erro que pode ir para o navegador,
 * conferência do segredo dos crons e validação do endereço da Suri.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Mensagem de erro segura pra devolver na API. O erro completo vai só pro log do servidor.
 * Erros do banco viram uma mensagem genérica (podem trazer nomes de tabela, host e consulta);
 * tokens e URLs internas saem do texto; respostas cruas de outros serviços são cortadas.
 */
export function publicError(err: unknown): string {
  console.error(err);
  const e = err as { name?: string; message?: string } | null;
  const msg = String(e?.message ?? "Erro inesperado.");
  if (e?.name === "NeonDbError" || /postgres(ql)?:\/\/|neon\.tech|relation "|column "|syntax error at|duplicate key/i.test(msg)) {
    return "Erro ao acessar o banco de dados. Tente de novo em instantes.";
  }
  return msg
    .replace(/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [removido]")
    .replace(/\b(key|token|secret)=[^&\s"']+/gi, "$1=[removido]")
    .slice(0, 400);
}

/** Resposta 500 (ou o status dado) com a mensagem segura. */
export const errorJson = (err: unknown, status = 500) => NextResponse.json({ error: publicError(err) }, { status });

/** A Vercel manda `Authorization: Bearer <CRON_SECRET>` nos crons. Sem CRON_SECRET configurado, recusa sempre. */
export function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  // comparação em tempo constante: não revela quantos caracteres batem
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Endereço dos chatbots da Suri (ex.: https://cbm-ctb-babysuri-cb123-chatbot-maker.azurewebsites.net). */
const SURI_HOST = /^cbm-[a-z0-9]+-[a-z0-9]+-cb\d+-[a-z0-9-]+\.azurewebsites\.net$/i;

/** null = endereço aceito; senão, o motivo da recusa. */
export function checkSuriUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Endereço do chatbot inválido.";
  }
  if (u.protocol !== "https:") return "O endereço do chatbot precisa começar com https://.";
  if (!SURI_HOST.test(u.hostname) || u.username || u.password) return "Informe o endereço do chatbot na Suri (…-cbNNN-chatbot-maker.azurewebsites.net).";
  return null;
}

export const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};
