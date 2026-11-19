import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/** Só contas Google deste domínio (Google Workspace) entram na plataforma. */
export const ALLOWED_DOMAIN = "chatbotmaker.io";

export const isAllowedEmail = (email?: string | null) =>
  !!email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);

/**
 * Login só pelo Google. O parâmetro `hd` faz a tela do Google já sugerir contas do domínio,
 * mas não é garantia (dá pra burlar mexendo na URL) — quem barra de verdade é o callback
 * signIn, que confere o e-mail verificado e o `hd` devolvidos pelo Google.
 * Sessão em JWT (cookie criptografado com AUTH_SECRET): nada é gravado no banco.
 *
 * Como o JWT não pode ser revogado, a sessão vale no máximo SESSION_HOURS desde o login, mesmo
 * com uso contínuo: quem sai da empresa (conta Google desativada) perde o acesso nesse prazo.
 */
const SESSION_HOURS = 12;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_HOURS * 3600 },
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      return profile?.email_verified === true && profile.hd === ALLOWED_DOMAIN && isAllowedEmail(profile.email);
    },
    jwt({ token, account }) {
      // hora do login; sessões abertas antes desta regra contam a partir da última renovação do cookie
      if (account) token.loginAt = Date.now();
      else if (typeof token.loginAt !== "number") token.loginAt = typeof token.iat === "number" ? token.iat * 1000 : Date.now();
      if (Date.now() - (token.loginAt as number) > SESSION_HOURS * 3600 * 1000) return null; // expira: volta pro login
      return token;
    },
  },
});
