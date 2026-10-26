import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SUPER_ADMIN, isAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// Quem está logado e se é administrador — a barra do topo usa pra mostrar Ajustes e Conversas.
export async function GET() {
  try {
    const email = (await auth())?.user?.email?.toLowerCase() ?? null;
    return NextResponse.json({ email, isAdmin: await isAdmin(email), isSuperAdmin: email === SUPER_ADMIN });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
