"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFilterState } from "./useFilterState";
import SettingsPanel from "./SettingsPanel";
import SettingsModal from "./SettingsModal";
import TopBar from "./TopBar";
import Icon from "./Icon";
import { conversationUrl } from "@/lib/portal";
import type { ConversationContactDto } from "@/lib/types";

// Tela TEMPORÁRIA: espelho só-leitura das filas do portal da Suri (Esperando, Atendimentos e
// Automático) nos setores salvos dos Ajustes, com o histórico no formato de chat do WhatsApp.

// agent.status do contato → aba; Esperando e Atendimentos vêm primeiro (são as que pedem ação)
const QUEUES = [
  { status: 1, label: "Esperando", cls: "wait" },
  { status: 2, label: "Atendimentos", cls: "att" },
  { status: 0, label: "Automático", cls: "auto" },
] as const;
type QueueStatus = (typeof QUEUES)[number]["status"];

type Message = {
  id: string;
  type: string;
  senderId: string;
  text: string | null;
  createdDate: string;
  attachment: { url: string; size: number; name?: string; contentType?: string } | null;
  custom: Record<string, string> | null;
};
type Kind = "client" | "agent" | "bot" | "system";

const STEP_DAYS = 7;
const LIST_REFRESH_MS = 60_000;
const CHAT_REFRESH_MS = 20_000;
const PREF_KEY = "conversas.prefs";

type Prefs = { deptIds?: string[] | null; attendantId?: string; queue?: QueueStatus };
const readPrefs = (): Prefs => {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const writePrefs = (p: Prefs) => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {}
};

function kindOf(m: Message, contactId: string): Kind {
  if (m.type === "SystemMessage" || !m.senderId) return "system";
  if (m.custom?.senderType === "chatbot") return "bot";
  if (m.custom?.senderType === "agent" || m.custom?.agentId) return "agent";
  // cliente: "usr:{id do contato}" (ou o mesmo número em outro canal, ex.: usr:wpsuriatendimento:55...)
  if (m.senderId === `usr:${contactId}`) return "client";
  const phone = contactId.split(":").pop();
  if (m.senderId.startsWith("usr:") && phone && m.senderId.endsWith(`:${phone}`)) return "client";
  // "usr:cb1000019" é o próprio chatbot (campanhas, mensagens automáticas)
  if (/^usr:cb\d+$/i.test(m.senderId)) return "bot";
  return m.senderId.startsWith("usr:") ? "client" : "agent";
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const fmtDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${fmtTime(d)}`;
};

function dayLabel(d: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return "Hoje";
  if (sameDay(d, yesterday)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

/** Horário da mensagem: só a hora se for de hoje; de outro dia, "dd/mm HH:mm". */
const msgStamp = (d: Date) => (sameDay(d, new Date()) ? fmtTime(d) : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${fmtTime(d)}`);

/** Horário à direita do item da lista: hora se for hoje, data se não. */
const listStamp = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return sameDay(d, new Date()) ? fmtTime(d) : fmtDate(d);
};

function since(iso: string | null) {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}min`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h${min % 60 ? ` ${pad(min % 60)}min` : ""}`;
  return `${Math.floor(min / 1440)}d`;
}

function fmtPhone(phone: string | null) {
  if (!phone) return "—";
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const n = d.slice(4);
    return `+55 ${ddd} ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
  }
  return `+${d}`;
}

const initial = (name: string) => (name.trim().charAt(0) || "?").toUpperCase();

// Formatação do WhatsApp: *negrito*, _itálico_, ~riscado~, ```mono``` e links clicáveis.
const RICH = /(https?:\/\/[^\s<]+)|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~|```([^`]+)```/g;
function rich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(RICH)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<a key={k++} href={m[1]} target="_blank" rel="noreferrer">{m[1]}</a>);
    else if (m[2]) out.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k++}>{m[3]}</em>);
    else if (m[4]) out.push(<s key={k++}>{m[4]}</s>);
    else if (m[5]) out.push(<code key={k++}>{m[5]}</code>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function attachmentKind(url: string, contentType?: string) {
  const path = decodeURIComponent(url.split("?")[0]).toLowerCase();
  const ct = contentType?.toLowerCase() ?? "";
  if (ct.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/.test(path)) return "image";
  if (ct.startsWith("audio/") || /\.(ogg|oga|opus|mp3|m4a|wav|aac)$/.test(path)) return "audio";
  if (ct.startsWith("video/") || /\.(mp4|mov|webm|3gp)$/.test(path)) return "video";
  return "file";
}

function Attachment({ a }: { a: NonNullable<Message["attachment"]> }) {
  const kind = attachmentKind(a.url, a.contentType);
  if (kind === "image")
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="cv-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.url} alt={a.name ?? "imagem"} loading="lazy" />
      </a>
    );
  if (kind === "audio") return <audio className="cv-audio" controls preload="none" src={a.url} />;
  if (kind === "video") return <video className="cv-media" controls preload="none" src={a.url} />;
  const name = a.name || decodeURIComponent(a.url.split("?")[0].split("/").pop() ?? "arquivo").replace(/^user_files\//, "");
  return (
    <a href={a.url} target="_blank" rel="noreferrer" className="cv-file">
      <Icon name="document" />
      <span>{name}</span>
    </a>
  );
}

function Avatar({ url, name, size = 40 }: { url: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (url && !broken)
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="cv-avatar" style={style} src={url} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return (
    <span className="cv-avatar cv-avatar-fallback" style={style}>
      {initial(name)}
    </span>
  );
}

function Bubble({ m, kind, contactName }: { m: Message; kind: Kind; contactName: string }) {
  const d = new Date(m.createdDate);
  if (kind === "system")
    return (
      <div className="cv-system">
        <span>{m.text}</span>
        <time dateTime={m.createdDate}>{msgStamp(d)}</time>
      </div>
    );
  const author = kind === "client" ? contactName : kind === "bot" ? "Suri Oficial" : m.custom?.agentName ?? "Atendente";
  // botões de template vêm em custom.templateCta: "Sim~:~;Talvez~:~;Não~:"
  const ctas = m.custom?.templateCta
    ?.split("~;")
    .map((s) => s.replace(/~:.*$/, "").trim())
    .filter(Boolean);
  return (
    <div className={`cv-row ${kind === "client" ? "in" : "out"}`}>
      <div className={`cv-bubble cv-${kind}`}>
        <div className="cv-author">{author}</div>
        {m.attachment?.url && <Attachment a={m.attachment} />}
        {m.text && <div className="cv-text">{rich(m.text)}</div>}
        {ctas && ctas.length > 0 && (
          <div className="cv-ctas">
            {ctas.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        )}
        <div className="cv-meta">
          {m.custom?.sendOrigin === "campaign" && <span className="cv-tag">campanha</span>}
          <time dateTime={m.createdDate} title={fmtDateTime(m.createdDate)}>{msgStamp(d)}</time>
        </div>
      </div>
    </div>
  );
}

export default function ConversationsView() {
  const f = useFilterState();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // setores filtrados (null = todos os salvos), atendente e aba, lembrados da última visita
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [deptIds, setDeptIds] = useState<string[] | null>(null);
  const [attendantId, setAttendantId] = useState("");
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [contacts, setContacts] = useState<ConversationContactDto[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [chatbotId, setChatbotId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [autoTruncated, setAutoTruncated] = useState(false);
  // busca da aba Automático: vai na base inteira pelo servidor (não só nos contatos de hoje)
  const [autoSearch, setAutoSearch] = useState<{
    q: string;
    loading: boolean;
    contacts: ConversationContactDto[];
    total: number;
    scannedUntil: string | null;
    error: string | null;
  } | null>(null);
  // ordem por aba: em Esperando quem aguarda há mais tempo vem primeiro; nas outras, o mais recente
  const [sortOverride, setSortOverride] = useState<Partial<Record<QueueStatus, boolean>>>({});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // janela do histórico em dias (mínimo 7); cresce de 7 em 7 ao rolar até o topo
  const [days, setDays] = useState(STEP_DAYS);
  const [hasMore, setHasMore] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  // como posicionar o scroll depois de carregar mensagens: fim da conversa ou manter onde estava
  const scrollMode = useRef<{ mode: "bottom" } | { mode: "keep"; fromBottom: number } | null>(null);

  // localStorage só depois de montar (no servidor ele não existe)
  useEffect(() => {
    const p = readPrefs();
    setDeptIds(p.deptIds?.length ? p.deptIds : null);
    setAttendantId(p.attendantId ?? "");
    setQueue(p.queue ?? null);
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (prefsLoaded) writePrefs({ deptIds, attendantId, queue: queue ?? undefined });
  }, [prefsLoaded, deptIds, attendantId, queue]);

  const deptIdsKey = deptIds?.join(",") ?? "";
  const loadList = useCallback(
    async (silent = false) => {
      if (!silent) setListLoading(true);
      try {
        const r = await fetch(`/api/conversations${deptIdsKey ? `?departmentIds=${encodeURIComponent(deptIdsKey)}` : ""}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Falha ao carregar conversas");
        const list = j.contacts as ConversationContactDto[];
        setContacts(list);
        setTruncated(j.truncated);
        setAutoTruncated(j.automaticTruncated);
        setChatbotId(j.chatbotId);
        setUpdatedAt(new Date());
        setListError(null);
        // primeira visita: abre em Esperando se tiver alguém aguardando, senão em Atendimentos
        setQueue((q) => q ?? (list.some((c) => c.status === 1) ? 1 : 2));
      } catch (e: any) {
        if (!silent) setListError(e.message);
      } finally {
        if (!silent) setListLoading(false);
      }
    },
    [deptIdsKey]
  );

  useEffect(() => {
    if (!f.configured || !prefsLoaded) return;
    loadList();
    const t = setInterval(() => loadList(true), LIST_REFRESH_MS);
    return () => clearInterval(t);
  }, [loadList, f.configured, prefsLoaded]);

  // Automático + 3 caracteres ou mais: busca na base inteira (espera parar de digitar)
  const autoQuery = queue === 0 ? search.trim() : "";
  useEffect(() => {
    if (autoQuery.length < 3) {
      setAutoSearch(null);
      return;
    }
    const ctrl = new AbortController();
    setAutoSearch((s) => ({ q: autoQuery, loading: true, contacts: s?.contacts ?? [], total: s?.total ?? 0, scannedUntil: null, error: null }));
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/conversations/search?q=${encodeURIComponent(autoQuery)}`, { signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Falha na busca");
        setAutoSearch({ q: autoQuery, loading: false, contacts: j.contacts, total: j.total, scannedUntil: j.scannedUntil, error: null });
      } catch (e: any) {
        if (e.name !== "AbortError") setAutoSearch({ q: autoQuery, loading: false, contacts: [], total: 0, scannedUntil: null, error: e.message });
      }
    }, 600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [autoQuery]);

  // after = quantas mensagens já estão na tela: o servidor alarga a janela até trazer algo além disso
  const loadMessages = useCallback(async (userId: string, windowDays: number, silent = false, after = 0) => {
    if (!silent) setMsgLoading(true);
    try {
      const q = new URLSearchParams({ userId, days: String(windowDays), after: String(after) });
      const r = await fetch(`/api/conversations/messages?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falha ao carregar mensagens");
      setDays(j.days);
      const el = scrollRef.current;
      if (silent && el) {
        // atualização automática: só desce pro fim se a pessoa já estava lá
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        scrollMode.current = atBottom ? { mode: "bottom" } : { mode: "keep", fromBottom: el.scrollHeight - el.scrollTop };
      }
      setMessages([...(j.messages as Message[])].reverse());
      setHasMore(j.hasMore);
      setMsgError(null);
    } catch (e: any) {
      if (!silent) setMsgError(e.message);
    } finally {
      if (!silent) setMsgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setMessages([]);
    setDays(STEP_DAYS);
    setHasMore(false);
    scrollMode.current = { mode: "bottom" };
    loadMessages(selectedId, STEP_DAYS);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    if (!selectedId || olderLoading) return;
    const t = setInterval(() => loadMessages(selectedId, days, true), CHAT_REFRESH_MS);
    return () => clearInterval(t);
  }, [selectedId, days, olderLoading, loadMessages]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const s = scrollMode.current;
    if (!el || !s || !messages.length) return;
    el.scrollTop = s.mode === "bottom" ? el.scrollHeight : el.scrollHeight - s.fromBottom;
    scrollMode.current = null;
  }, [messages]);

  const loadOlder = async () => {
    if (!selectedId || !scrollRef.current || !hasMore || olderLoading || msgLoading) return;
    const el = scrollRef.current;
    scrollMode.current = { mode: "keep", fromBottom: el.scrollHeight - el.scrollTop };
    setOlderLoading(true);
    await loadMessages(selectedId, days + STEP_DAYS, true, messages.length);
    setOlderLoading(false);
  };

  // chegou no topo da conversa: mais 7 dias pra trás
  const onMessagesScroll = () => {
    if ((scrollRef.current?.scrollTop ?? 1) < 40) loadOlder();
  };

  // busca e atendente valem pra todas as abas; a contagem de cada aba já sai filtrada
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return contacts.filter(
      (c) =>
        // Automático não tem atendente nem filtro de setor (vem da base inteira)
        (!attendantId || c.status === 0 || c.attendantId === attendantId) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.identificationDocument ?? "").toLowerCase().includes(q) ||
          (c.attendantName ?? "").toLowerCase().includes(q) ||
          (c.departmentName ?? "").toLowerCase().includes(q) ||
          (digits.length >= 3 && (c.phone ?? "").includes(digits)))
    );
  }, [contacts, search, attendantId]);

  const counts = useMemo(() => {
    const n: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    filtered.forEach((c) => (n[c.status] = (n[c.status] ?? 0) + 1));
    if (autoSearch && !autoSearch.loading) n[0] = autoSearch.total;
    return n;
  }, [filtered, autoSearch]);

  const oldestFirst = queue == null ? false : sortOverride[queue] ?? queue === 1;

  const visible = useMemo(() => {
    // Esperando: desde o pedido de atendimento; Atendimentos: última mensagem ou início; Automático: última atividade
    const ts = (c: ConversationContactDto) =>
      new Date((queue === 1 ? c.dateRequest : queue === 0 ? c.lastActivity ?? c.lastMessageAt ?? c.dateCreate : c.lastMessageAt ?? c.dateAnswer) ?? 0).getTime();
    // Automático com busca: resultado da base inteira, de qualquer fila
    const list = queue === 0 && autoSearch ? autoSearch.contacts : filtered.filter((c) => c.status === queue);
    return [...list].sort((a, b) => (oldestFirst ? ts(a) - ts(b) : ts(b) - ts(a)));
  }, [filtered, queue, oldestFirst, autoSearch]);

  const attendantOptions = useMemo(() => {
    const m = new Map<string, string>();
    contacts.forEach((c) => c.attendantId && m.set(c.attendantId, c.attendantName ?? c.attendantId));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts]);

  const savedDepts = f.activeDepartments;
  const deptFilterOn = deptIds != null && deptIds.length < savedDepts.length;
  const toggleDept = (id: string) => {
    const cur = deptIds ?? savedDepts.map((d) => d.departmentId);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (!next.length) return; // pelo menos um setor
    setDeptIds(next.length === savedDepts.length ? null : next);
    setSelectedId(null);
  };

  const selected = contacts.find((c) => c.id === selectedId) ?? autoSearch?.contacts.find((c) => c.id === selectedId) ?? null;

  return (
    <>
      <TopBar breadcrumb="Atendimento / Temporária" title="Conversas" configured={f.configured} onOpenSettings={() => setSettingsOpen(true)} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel config={f.config} departments={f.departments} onConfigSaved={f.loadConfig} onDepartmentsChanged={f.loadDepartments} />
      </SettingsModal>

      <div className="wrap cv-wrap">

        {!f.configured && (
          <div className="error-box">
            Configure a URL do chatbot e o token clicando no ícone de ajustes (<Icon name="settings" />) no topo da página para começar.
          </div>
        )}

        <div className={`cv-layout ${selected ? "has-chat" : ""} ${showDetails ? "" : "no-details"}`}>
          {/* LISTA */}
          <aside className="cv-list">
            <div className="cv-list-filters">
              <div className="cv-search-row">
                <div className="cv-search">
                  <Icon name="search" />
                  <input type="text" placeholder="Busque por nome, telefone, e-mail, CNPJ…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <button
                  className={`topbar-icon-btn ${filterOpen || deptFilterOn || attendantId ? "on" : ""}`}
                  onClick={() => setFilterOpen((v) => !v)}
                  title="Filtrar por setor e atendente"
                  aria-label="Filtros"
                  aria-expanded={filterOpen}
                >
                  <Icon name="filter" />
                  {(deptFilterOn || attendantId) && <span className="cv-filter-dot" />}
                </button>
              </div>

              {filterOpen && (
                <div className="cv-filter-panel">
                  <div className="cv-filter-head">
                    <span>Setores salvos</span>
                    <button className="btn small" onClick={() => setDeptIds(null)} disabled={!deptFilterOn}>
                      Todos
                    </button>
                  </div>
                  <div className="cv-dept-list">
                    {savedDepts.map((d) => (
                      <label key={d.departmentId} className="checkbox-field">
                        <input type="checkbox" checked={!deptIds || deptIds.includes(d.departmentId)} onChange={() => toggleDept(d.departmentId)} />
                        {d.name}
                      </label>
                    ))}
                    {!savedDepts.length && <span className="hint">Nenhum setor salvo nos Ajustes.</span>}
                  </div>
                  <div className="field">
                    <label>Atendente</label>
                    <select value={attendantId} onChange={(e) => setAttendantId(e.target.value)}>
                      <option value="">Todos</option>
                      {attendantOptions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="cv-tabs" role="tablist">
                {QUEUES.map((qd) => (
                  <button
                    key={qd.status}
                    role="tab"
                    aria-selected={queue === qd.status}
                    className={`cv-tab cv-tab-${qd.cls} ${queue === qd.status ? "on" : ""}`}
                    onClick={() => setQueue(qd.status)}
                  >
                    <span className="cv-tab-count">{counts[qd.status]}</span>
                    {qd.label}
                  </button>
                ))}
              </div>

              <div className="cv-list-bar">
                <span>
                  {queue === 0
                    ? autoSearch
                      ? autoSearch.loading
                        ? "Buscando na base inteira…"
                        : `Busca na base inteira${autoSearch.total > autoSearch.contacts.length ? ` · ${autoSearch.contacts.length} de ${autoSearch.total}` : ""}${
                            autoSearch.scannedUntil ? ` · nomes desde ${fmtDate(new Date(autoSearch.scannedUntil))}` : ""
                          }`
                      : `Contatos de hoje, todos os setores${autoTruncated ? " · parcial" : ""}`
                    : deptFilterOn
                      ? `${deptIds!.length} de ${savedDepts.length} setores`
                      : "Todos os setores salvos"}
                  {queue !== 0 && truncated && " · parcial"}
                </span>
                <span className="cv-list-actions">
                  <button
                    className="btn small"
                    onClick={() => queue != null && setSortOverride((s) => ({ ...s, [queue]: !oldestFirst }))}
                    title={queue === 1 ? "Ordenar pelo tempo de espera" : "Ordenar pela última atividade"}
                  >
                    {oldestFirst ? "Mais antigos" : "Mais recentes"}
                  </button>
                  <button className="btn small btn-icon" onClick={() => loadList()} disabled={listLoading} title="Atualizar lista">
                    <Icon name="refresh" />
                  </button>
                </span>
              </div>
            </div>

            <div className="cv-list-items">
              {listError && <div className="error-box">{listError}</div>}
              {listLoading && !contacts.length && <div className="loading">Carregando conversas…</div>}
              {queue === 0 && autoSearch?.error && <div className="error-box">{autoSearch.error}</div>}
              {queue === 0 && autoSearch?.loading && !autoSearch.contacts.length && <div className="loading">Buscando “{autoSearch.q}”…</div>}
              {!listLoading && !listError && queue != null && !visible.length && !autoSearch?.loading && (
                <div className="hint cv-empty">
                  {queue === 0 && autoSearch
                    ? `Nenhum contato encontrado para “${autoSearch.q}”.`
                    : queue === 0
                      ? "Nenhum contato novo hoje."
                      : `Nenhuma conversa em ${QUEUES.find((qd) => qd.status === queue)!.label}.`}
                </div>
              )}
              {visible.map((c) => {
                const waiting = c.status === 1;
                const auto = c.status === 0;
                const ref = waiting ? c.dateRequest : auto ? c.lastActivity ?? c.lastMessageAt ?? c.dateCreate : c.lastMessageAt ?? c.dateAnswer;
                const elapsed = since(waiting ? c.dateRequest : auto ? null : c.dateAnswer);
                return (
                  <button key={c.id} className={`cv-item cv-item-${waiting ? "wait" : auto ? "auto" : "att"} ${c.id === selectedId ? "on" : ""}`} onClick={() => setSelectedId(c.id)}>
                    <Avatar url={c.avatarUrl} name={c.name} />
                    <span className="cv-item-body">
                      <span className="cv-item-top">
                        <span className="cv-item-name">{c.name}</span>
                        <span className="cv-item-time">{listStamp(ref)}</span>
                      </span>
                      <span className="cv-chips">
                        {/* resultado da busca do Automático que está em outra fila */}
                        {queue === 0 && !auto && <span className={`cv-chip ${waiting ? "warn" : ""}`}>{waiting ? "Esperando" : "Em atendimento"}</span>}
                        {c.departmentName && <span className="cv-chip">{c.departmentName}</span>}
                        {c.isTransferred && <span className="cv-chip warn">transferido</span>}
                      </span>
                      <span className="cv-item-bottom">
                        <span className="cv-item-agent">
                          {auto ? (
                            <>
                              <Icon name="comment-alt" /> com o bot
                            </>
                          ) : (
                            <>
                              <Icon name="user-headset" /> {c.attendantName ?? (waiting ? "aguardando atendente" : "—")}
                            </>
                          )}
                        </span>
                        {elapsed && (
                          <span
                            className={`cv-item-since ${waiting ? "urgent" : ""}`}
                            title={waiting ? `Pediu atendimento em ${fmtDateTime(c.dateRequest)}` : `Atendimento iniciado em ${fmtDateTime(c.dateAnswer)}`}
                          >
                            {waiting ? "esperando" : "há"} {elapsed}
                          </span>
                        )}
                        {c.unreadMessages > 0 && <span className="cv-unread">{c.unreadMessages}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* CHAT */}
          <section className="cv-chat">
            {!selected ? (
              <div className="cv-placeholder">
                <Icon name="comments" />
                <p>Selecione uma conversa para ver o histórico</p>
              </div>
            ) : (
              <>
                <div className="cv-chat-head">
                  <button className="topbar-icon-btn cv-back" onClick={() => setSelectedId(null)} aria-label="Voltar para a lista">
                    <Icon name="angle-left" />
                  </button>
                  <Avatar url={selected.avatarUrl} name={selected.name} size={36} />
                  <div className="cv-chat-title">
                    <strong>{selected.name}</strong>
                    <span>
                      {fmtPhone(selected.phone)} · {selected.attendantName ?? "sem atendente"}
                    </span>
                  </div>
                  <div className="cv-chat-actions">
                    <button className="topbar-icon-btn" onClick={() => loadMessages(selected.id, days)} title="Atualizar conversa" aria-label="Atualizar conversa">
                      <Icon name="refresh" />
                    </button>
                    {chatbotId && (
                      <a className="topbar-icon-btn" href={conversationUrl(chatbotId, selected.id)} target="_blank" rel="noreferrer" title="Abrir no portal da Suri" aria-label="Abrir no portal da Suri">
                        <Icon name="arrow-up-right-from-square" />
                      </a>
                    )}
                    <button className={`topbar-icon-btn ${showDetails ? "on" : ""}`} onClick={() => setShowDetails((v) => !v)} title="Detalhes do contato" aria-label="Detalhes do contato">
                      <Icon name="info" />
                    </button>
                  </div>
                </div>

                <div className="cv-messages" ref={scrollRef} onScroll={onMessagesScroll}>
                  {messages.length > 0 && (
                    <div className="cv-older">
                      {olderLoading ? (
                        <span className="hint">Carregando mais 7 dias…</span>
                      ) : hasMore ? (
                        <button className="btn small" onClick={loadOlder} title="Ou role até o topo">
                          Mensagens desde {fmtDateTime(new Date(Date.now() - days * 86_400_000).toISOString()).slice(0, 10)} · carregar mais 7 dias
                        </button>
                      ) : (
                        <span className="hint">Início da conversa</span>
                      )}
                    </div>
                  )}
                  {msgError && <div className="error-box">{msgError}</div>}
                  {msgLoading && !messages.length && <div className="loading cv-center">Carregando mensagens…</div>}
                  {!msgLoading && !msgError && !messages.length && <div className="hint cv-center">Nenhuma mensagem.</div>}
                  {messages.map((m, i) => {
                    const d = new Date(m.createdDate);
                    const prev = messages[i - 1];
                    const newDay = !prev || !sameDay(d, new Date(prev.createdDate));
                    return (
                      <Fragment key={m.id}>
                        {newDay && (
                          <div className="cv-day">
                            <span>{dayLabel(d)}</span>
                          </div>
                        )}
                        <Bubble m={m} kind={kindOf(m, selected.id)} contactName={selected.name} />
                      </Fragment>
                    );
                  })}
                </div>

                <div className="cv-readonly">
                  <Icon name="info" /> Visualização somente leitura — para responder, abra a conversa no portal da Suri.
                </div>
              </>
            )}
          </section>

          {/* DETALHES */}
          {selected && showDetails && (
            <aside className="cv-details">
              <div className="cv-details-head">
                <Avatar url={selected.avatarUrl} name={selected.name} size={84} />
                <strong>{selected.name}</strong>
                <span>{fmtPhone(selected.phone)}</span>
              </div>
              <dl>
                <dt>E-mail</dt>
                <dd>{selected.email ?? "—"}</dd>
                <dt>Identificação</dt>
                <dd>{selected.identificationDocument ?? "—"}</dd>
                <dt>Observação</dt>
                <dd className="cv-pre">{selected.note ?? "—"}</dd>
              </dl>
              <h4>Carteira</h4>
              <dl className="cv-grid">
                <dt>Departamento</dt>
                <dd>{selected.departmentName ?? "—"}</dd>
                <dt>Agente</dt>
                <dd>{selected.attendantName ?? "—"}</dd>
              </dl>
              <h4>Atendimento</h4>
              <dl className="cv-grid">
                <dt>Status</dt>
                <dd>{QUEUES.find((qd) => qd.status === selected.status)?.label ?? "—"}</dd>
                <dt>Solicitado</dt>
                <dd>{fmtDateTime(selected.dateRequest)}</dd>
                <dt>Iniciado</dt>
                <dd>{fmtDateTime(selected.dateAnswer)}</dd>
                <dt>Última mensagem</dt>
                <dd>{fmtDateTime(selected.lastMessageAt)}</dd>
                <dt>Janela 24h</dt>
                <dd>
                  {selected.sessionWindowEnd && new Date(selected.sessionWindowEnd) > new Date()
                    ? `aberta até ${fmtDateTime(selected.sessionWindowEnd)}`
                    : "fechada"}
                </dd>
                <dt>Contato desde</dt>
                <dd>{fmtDateTime(selected.dateCreate)}</dd>
              </dl>
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
