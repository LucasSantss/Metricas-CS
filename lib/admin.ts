import { NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/auth";
import { isAdminRow } from "./db";

/**
 * Administrador fixo: sempre é administrador e não pode ser removido pela tela.
 * Os demais ficam na tabela `admins` (adicionados por um administrador em Ajustes > Administradores).
 * Só administradores veem a aba Conversas e os Ajustes; as outras abas são de todos.
 */
export const SUPER_ADMIN = "lucasrodrigues@chatbotmaker.io";

export async function isAdmin(email?: string | null): Promise<boolean> {
  if (!email || !isAllowedEmail(email)) return false;
  const e = email.toLowerCase();
  return e === SUPER_ADMIN || (await isAdminRow(e));
}

/** E-mail do usuário logado, se ele for administrador. */
export async function currentAdmin(): Promise<string | null> {
  const email = (await auth())?.user?.email ?? null;
  return (await isAdmin(email)) ? email!.toLowerCase() : null;
}

/** Nas rotas de API: devolve 403 se quem chamou não é administrador, senão null. */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (await currentAdmin()) return null;
  return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
}
