import { NextResponse } from "next/server";
import { upsertDepartment } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// Os 6 setores que devem ser acompanhados no momento (departmentId + nome
// vindos direto da configuração do chatbot na Suri).
const KNOWN_DEPARTMENTS = [
  { departmentId: "cb1020285", name: "Suporte - N1" },
  { departmentId: "cb99114347", name: "Suporte - N2" },
  { departmentId: "cb172791822", name: "Suporte IA - N2" },
  { departmentId: "cb151889035", name: "Suporte - Conexão" },
  { departmentId: "cb1152009", name: "Suporte - Financeiro" },
  { departmentId: "cb11393648", name: "Retorno ao Cliente" },
];

// Cria/atualiza (nome apenas) os setores conhecidos, sem mexer em metas ou
// atendentes já configurados.
export async function POST() {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const departments = await Promise.all(
      KNOWN_DEPARTMENTS.map((d, i) => upsertDepartment({ departmentId: d.departmentId, name: d.name, sortOrder: i }))
    );
    return NextResponse.json({ departments });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
