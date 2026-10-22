import { redirect } from "next/navigation";
import { ALLOWED_DOMAIN, auth, isAllowedEmail, signIn } from "@/auth";

export const metadata = { title: "Entrar · Termômetro Operacional" };

const ERRORS: Record<string, string> = {
  AccessDenied: `Acesso permitido só para contas @${ALLOWED_DOMAIN}.`,
};

// só caminhos internos, pra o callbackUrl não virar redirecionamento pra fora
const safePath = (p?: string) => (p && p.startsWith("/") && !p.startsWith("//") ? p : "/");

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = safePath(callbackUrl);

  const session = await auth();
  if (isAllowedEmail(session?.user?.email)) redirect(redirectTo);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-title">Termômetro Operacional</div>
        <div className="login-sub">Entre com sua conta Google @{ALLOWED_DOMAIN}</div>
        {error && <div className="login-error">{ERRORS[error] ?? "Não foi possível entrar. Tente novamente."}</div>}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
          }}
        >
          <button type="submit" className="btn primary login-btn">
            Entrar com Google
          </button>
        </form>
      </div>
    </div>
  );
}
