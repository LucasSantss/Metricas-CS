import { NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/auth";

/**
 * Toda a plataforma exige login com uma conta do domínio (auth.ts). Ficam de fora só os
 * caminhos EXATOS de PUBLIC (uma rota nova nunca fica pública por começar com o mesmo nome):
 * - /login e /api/auth/* (o próprio fluxo de login);
 * - os crons em /api/ticket-reports/cron, que a Vercel chama sem usuário e se protegem com CRON_SECRET;
 * - arquivos estáticos (ver `matcher`).
 * Nas rotas de API, em vez de redirecionar pro /login, responde 401 em JSON.
 */
const PUBLIC = [/^\/login$/, /^\/api\/auth\//, /^\/api\/ticket-reports\/cron(\/(ka|resolvidos))?$/];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return;
  if (isAllowedEmail(req.auth?.user?.email)) return;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const url = new URL("/login", req.nextUrl.origin);
  if (pathname !== "/") url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
});

export const config = {
  // _next/image fica protegido (a plataforma não usa next/image): o otimizador de imagens não fica exposto sem login
  matcher: ["/((?!_next/static|favicon\\.ico$|icon\\.jpg$|apple-icon\\.jpg$).*)"],
};
