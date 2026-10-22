import { NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/auth";

/**
 * Toda a plataforma exige login com uma conta do domínio (auth.ts). Ficam de fora só:
 * - /login e /api/auth/* (o próprio fluxo de login);
 * - /api/ticket-reports/cron, que a Vercel chama sem usuário e já se protege com CRON_SECRET;
 * - arquivos estáticos (ver `matcher`).
 * Nas rotas de API, em vez de redirecionar pro /login, responde 401 em JSON.
 */
export default auth((req) => {
  if (isAllowedEmail(req.auth?.user?.email)) return;
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const url = new URL("/login", req.nextUrl.origin);
  if (pathname !== "/") url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: [
    "/((?!login|api/auth|api/ticket-reports/cron|_next/static|_next/image|favicon.ico|icon.jpg|apple-icon.jpg).*)",
  ],
};
