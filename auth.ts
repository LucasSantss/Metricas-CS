import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/** Só contas Google destes domínios (Google Workspace) entram na plataforma. */
export const ALLOWED_DOMAINS = ["chatbotmaker.io", "rdstation.com"];

/** Texto pra mensagens: "@chatbotmaker.io ou @rdstation.com". */
export const ALLOWED_DOMAINS_LABEL = ALLOWED_DOMAINS.map((d) => `@${d}`).join(" ou ");

const domainOf = (email?: string | null) => email?.toLowerCase().split("@")[1];

export const isAllowedEmail = (email?: string | null) => {
  const d = domainOf(email);
  return !!d && ALLOWED_DOMAINS.includes(d);
};

/**
 * Login só pelo Google. O parâmetro `hd` do Google aceita um domínio só, então não é usado
 * (com dois domínios ele esconderia as contas do outro). Quem barra de verdade é o callback
 * signIn, que confere o e-mail verificado e o `hd` (domínio Workspace) devolvidos pelo Google.
 * Sessão em JWT (cookie criptografado com AUTH_SECRET): nada é gravado no banco.
 *
 * Como o JWT não pode ser revogado, a sessão vale no máximo SESSION_HOURS desde o login, mesmo
 * com uso contínuo: quem sai da empresa (conta Google desativada) perde o acesso nesse prazo.
 */
const SESSION_HOURS = 12;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_HOURS * 3600 },
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      const hd = typeof profile?.hd === "string" ? profile.hd.toLowerCase() : "";
      return (
        profile?.email_verified === true &&
        ALLOWED_DOMAINS.includes(hd) &&
        isAllowedEmail(profile.email) &&
        domainOf(profile.email) === hd
      );
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
