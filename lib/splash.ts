/** Chave na sessionStorage: a tela inicial aparece só no primeiro acesso de cada sessão do navegador. */
export const SPLASH_KEY = "cs:splash-shown";

/**
 * Script do <head> (app/layout.tsx): roda antes da primeira pintura e liga a classe "splash"
 * no <html> se a tela inicial ainda não apareceu nesta sessão (e anota em window.__splashAt
 * quando ela começou a aparecer, pra contar o 1 s a partir daí). Em try/catch porque a
 * sessionStorage pode estar bloqueada (aí a tela inicial simplesmente não aparece).
 */
export const SPLASH_SCRIPT = `try{if(!sessionStorage.getItem(${JSON.stringify(SPLASH_KEY)})){document.documentElement.classList.add("splash");window.__splashAt=performance.now()}}catch(e){}`;
