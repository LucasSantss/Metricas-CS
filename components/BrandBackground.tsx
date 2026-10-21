/**
 * Fundo animado no estilo da logo "CS Suporte" (Suri Shop): base quase preta,
 * placas curvas em grafite e a grande curva azul com borda escura. As camadas
 * só se deslocam devagar (transform, sem repintar), atrás de todo o conteúdo;
 * com "reduzir movimento" ligado no sistema, o fundo fica parado.
 */
export default function BrandBackground() {
  return (
    <div className="brand-bg" aria-hidden="true">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        {/* placa grafite maior, vinda da esquerda */}
        <g className="bb-layer bb-slate-a">
          <path d="M -300 -200 C 250 -260 760 -120 980 160 C 1160 390 1020 760 820 1250 L -300 1250 Z" fill="#191d24" />
        </g>
        {/* placa grafite interna, um tom acima */}
        <g className="bb-layer bb-slate-b">
          <path d="M -300 -120 C 180 -150 560 -40 720 190 C 860 400 760 780 600 1250 L -300 1250 Z" fill="#1d222a" />
        </g>
        {/* curva azul com a borda escura por baixo */}
        <g className="bb-layer bb-blue">
          <path d="M 1900 -200 C 1460 -120 1120 160 960 470 C 830 720 770 940 730 1250 L 1900 1250 Z" fill="#0b0a3a" transform="translate(-26 0)" />
          <path d="M 1900 -200 C 1460 -120 1120 160 960 470 C 830 720 770 940 730 1250 L 1900 1250 Z" fill="url(#bbBlue)" />
        </g>
        <defs>
          <linearGradient id="bbBlue" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2412e6" />
            <stop offset="100%" stopColor="#1608b8" />
          </linearGradient>
        </defs>
      </svg>
      {/* véu escuro leve: mantém textos e campos fora dos cartões legíveis em cima do azul */}
      <div className="brand-bg-veil" />
    </div>
  );
}
