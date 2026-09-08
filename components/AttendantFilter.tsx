"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PeriodAttendantDto } from "@/lib/types";

type Props = {
  attendants: PeriodAttendantDto[];
  selected: string[]; // attendantId[], vazio = todos
  onChange: (ids: string[]) => void;
};

export default function AttendantFilter({ attendants, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => [...attendants].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [attendants]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, search]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const selectedNames = options.filter((o) => selected.includes(o.id)).map((o) => o.name);

  return (
    <div className="attendant-filter" ref={boxRef}>
      <button type="button" className="btn small" onClick={() => setOpen((v) => !v)}>
        👤 Atendente{selected.length > 0 ? ` (${selected.length})` : ": todos"}
      </button>

      {selectedNames.length > 0 && (
        <div className="attendant-chips">
          {selectedNames.map((name, i) => (
            <span key={name} className="chip">
              {name}
              <button type="button" aria-label={`Remover ${name}`} onClick={() => toggle(options.find((o) => o.name === name)!.id)}>
                ×
              </button>
            </span>
          ))}
          <button type="button" className="btn small" onClick={() => onChange([])}>
            Limpar
          </button>
        </div>
      )}

      {open && (
        <div className="attendant-dropdown">
          <input
            type="text"
            className="attendant-search"
            placeholder="Buscar atendente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="attendant-list">
            {filtered.length === 0 && (
              <div className="hint" style={{ padding: 8 }}>
                {options.length === 0 ? "Nenhum atendente nos resultados desta busca ainda." : "Nenhum atendente encontrado."}
              </div>
            )}
            {filtered.map((o) => {
              const isOn = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  className={`attendant-option ${isOn ? "on" : "off"}`}
                  aria-pressed={isOn}
                  onClick={() => toggle(o.id)}
                >
                  <span className="dept-toggle-check" />
                  <span className="attendant-option-name">{o.name}</span>
                  <span className="hint">{o.departments.join(", ")}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
