import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_DOMAIN, isAllowedEmail } from "@/auth";
import { deleteAdmin, insertAdmin, listAdminRows } from "@/lib/db";
import { SUPER_ADMIN, currentAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const forbidden = () => NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });

// Lista de administradores (Ajustes > Administradores). Só administradores leem e alteram.
export async function GET() {
  try {
    if (!(await currentAdmin())) return forbidden();
    const rows = await listAdminRows();
    return NextResponse.json({
      admins: [{ email: SUPER_ADMIN, addedBy: null, createdAt: null, fixed: true }, ...rows.filter((r) => r.email !== SUPER_ADMIN).map((r) => ({ ...r, fixed: false }))],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await currentAdmin();
    if (!me) return forbidden();
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    // só contas do domínio conseguem entrar na plataforma (auth.ts)
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || !isAllowedEmail(email)) {
      return NextResponse.json({ error: `Informe um e-mail @${ALLOWED_DOMAIN}.` }, { status: 400 });
    }
    if (email !== SUPER_ADMIN) await insertAdmin(email, me);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await currentAdmin())) return forbidden();
    const email = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
    if (email === SUPER_ADMIN) return NextResponse.json({ error: "O administrador principal não pode ser removido." }, { status: 400 });
    await deleteAdmin(email);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
