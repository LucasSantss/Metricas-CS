/**
 * Ícone da coleção UIcons da Flaticon (estilo "regular rounded", fonte em
 * @flaticon/flaticon-uicons, importada no app/layout.tsx). `name` é o nome
 * sem prefixo: "settings" → classe fi-rr-settings. Catálogo:
 * https://www.flaticon.com/uicons/interface-icons
 * A licença gratuita pede o crédito "Uicons by Flaticon" — fica no modal de Ajustes.
 */
export default function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <i className={`fi fi-rr-${name} ui-icon ${className}`} aria-hidden="true" />;
}
