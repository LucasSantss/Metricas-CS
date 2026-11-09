import type { BreakdownRow, ReportAi, ReportData } from "@/lib/ticketReport";

const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

function WeeklyTrend({ d }: { d: ReportData }) {
  const weeks = d.weekly ?? [];
  const top = Math.max(1, ...weeks.map((w) => w.created));
  return (
    <section className="tk-panel">
      <div className="tk-panel-head">
        <h2>Evolução semanal</h2>
        <span className="tk-panel-sub">tickets criados por semana{d.partial ? " · última semana parcial" : ""}</span>
      </div>
      <div className="tk-body">
        <div className="rp-trend" role="img" aria-label={`Tickets criados por semana: ${weeks.map((w) => `${ddmm(w.weekStart)}, ${w.created}`).join("; ")}`}>
          {weeks.map((w, i) => {
            const partial = d.partial && i === weeks.length - 1;
            return (
              <div className="rp-trend-col" key={w.weekStart} title={`Semana de ${ddmm(w.weekStart)}: ${w.created} ticket(s) criado(s)${partial ? " até agora" : ""}`}>
                <span className="rp-trend-value">{w.created}</span>
                <i className={`rp-trend-bar ${partial ? "partial" : ""}`} style={{ height: `calc((100% - 42px) * ${w.created / top})` }} />
                <span className="rp-trend-label">{ddmm(w.weekStart)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Reasons({ d, ai }: { d: ReportData; ai: ReportAi | null | undefined }) {
  const themes = [...(ai?.temasCriados ?? [])].sort((a, b) => b.ticketIds.length - a.ticketIds.length);
  const classified = themes.reduce((s, t) => s + t.ticketIds.length, 0);
  const rows = themes.map((t) => ({ motivo: t.titulo, n: t.ticketIds.length }));
  if (d.cur.created > classified) rows.push({ motivo: "Sem motivo identificado", n: d.cur.created - classified });
  return (
    <section className="tk-panel">
      <div className="tk-panel-head">
        <h2>Por motivo</h2>
        <span className="tk-panel-sub">criados na semana · agrupados pela IA, contados pela plataforma</span>
      </div>
      {ai && rows.length ? (
        <div className="tk-scroll">
          <table className="tk-table">
            <thead>
              <tr>
                <th>Motivo</th>
                <th className="num">Tickets</th>
                <th className="num">% dos criados</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.motivo}>
                  <td>{r.motivo}</td>
                  <td className="num">{r.n}</td>
                  <td className="num">{Math.round((r.n / d.cur.created) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tk-body">
          <span className="hint">{d.cur.created ? "A classificação por motivo depende do texto da IA, que não foi gerado nesta semana." : "Nenhum ticket criado nesta semana."}</span>
        </div>
      )}
    </section>
  );
}

function Breakdown({ title, sub, label, rows }: { title: string; sub: string; label: string; rows: BreakdownRow[] }) {
  return (
    <section className="tk-panel">
      <div className="tk-panel-head">
        <h2>{title}</h2>
        <span className="tk-panel-sub">{sub}</span>
      </div>
      <div className="tk-scroll rp-client-scroll">
        <table className="tk-table">
          <thead>
            <tr>
              <th>{label}</th>
              <th className="num">Criados</th>
              <th className="num">Movimentados</th>
              <th className="num">Em aberto</th>
              <th className="num">SLA estourado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{r.created}</td>
                <td className="num">{r.moved}</td>
                <td className="num">{r.open}</td>
                <td className="num">{r.late}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Channel() {
  return (
    <section className="tk-panel">
      <div className="tk-panel-head">
        <h2>Por canal de atendimento</h2>
        <span className="tk-panel-sub">indisponível</span>
      </div>
      <div className="tk-body">
        <span className="hint">A exportação de tickets do SoftCS Bot não informa por qual canal cada ticket chegou, então este indicador ainda não pode ser calculado.</span>
      </div>
    </section>
  );
}

/** Indicadores da visão KA: volume semanal, motivo, cliente, jornada e canal. */
export default function KaIndicators({ d, ai }: { d: ReportData; ai: ReportAi | null | undefined }) {
  return (
    <>
      <div className="tk-grid2">
        <WeeklyTrend d={d} />
        <Reasons d={d} ai={ai} />
      </div>
      <div className="tk-grid2">
        <Breakdown title="Por cliente" sub={`${d.byClient?.length ?? 0} cliente(s) KA com tickets na semana`} label="Cliente" rows={d.byClient ?? []} />
        <Breakdown title="Por jornada" sub="cliente em mais de uma jornada conta em cada" label="Jornada" rows={d.byJourney ?? []} />
      </div>
      <Channel />
    </>
  );
}
