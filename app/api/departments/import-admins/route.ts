import { NextRequest, NextResponse } from "next/server";
import { listDepartments, upsertDepartment } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

type SuriAdmin = {
  id: string;
  name: string;
  departments?: string[];
};

/**
 * Recebe o JSON de configuração do chatbot (o mesmo retornado pelo painel
 * admin da Suri, com um array "admins" onde cada atendente tem sua lista
 * de "departments"). Para cada setor já cadastrado aqui, recalcula
 * attendantIds = atendentes cujo array "departments" contém aquele
 * departmentId.
 */
export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const body = await req.json();
    const admins: SuriAdmin[] = Array.isArray(body?.admins) ? body.admins : [];
    if (admins.length === 0) {
      return NextResponse.json({ error: "JSON inválido: não encontrei um array 'admins'." }, { status: 400 });
    }

    const departments = await listDepartments();
    const results = [];
    for (const dept of departments) {
      const attendantIds = admins
        .filter((a) => Array.isArray(a.departments) && a.departments.includes(dept.departmentId))
        .map((a) => a.id);
      await upsertDepartment({
        departmentId: dept.departmentId,
        name: dept.name,
        attendantIds,
      });
      results.push({ departmentId: dept.departmentId, name: dept.name, attendantCount: attendantIds.length });
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
