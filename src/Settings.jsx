import React, { useState } from 'react';
import { SPORT_SORTS, GAME_SORTS, RANGES } from './sorting.js';

// Slide-over settings panel. Everything it shows arrives as props, so it has no ties to the dashboard.
//   plugins:  [{ id, name, category, desc }]   every sport widget that exists
//   alerts / watcher: { on, toggle } (watcher is null off Android)
export default function SettingsPanel({ open, onClose, plugins, settings, update, togglePlugin, setPlugins, alerts, watcher, onReset }) {
  const [query, setQuery] = useState('');
  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matches = (p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
  const categories = [...new Set(plugins.map((p) => p.category))];

  const select = (label, value, options, key) => (
    <label style={s.row}>
      <span>{label}</span>
      <select style={s.select} value={value} onChange={(e) => update({ [key]: e.target.value })}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label.replace(/^[^:]+:\s*/, '')}</option>)}
      </select>
    </label>
  );
  const toggleRow = (label, hint, on, onChange) => (
    <div style={s.row}>
      <span>
        {label}
        {hint && <div style={s.hint}>{hint}</div>}
      </span>
      <button style={{ ...s.switch, backgroundColor: on ? '#38a169' : '#4a5568' }} onClick={onChange} aria-pressed={on}>
        {on ? 'On' : 'Off'}
      </button>
    </div>
  );

  return (
    <div style={s.overlay} onClick={onClose}>
      <aside style={s.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div style={s.head}>
          <h3 style={{ margin: 0 }}>⚙️ Settings</h3>
          <button style={s.close} onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <h4 style={s.h}>Layout</h4>
        {select('View', settings.range, RANGES, 'range')}
        {toggleRow('Active games only', 'Hide finished and upcoming games and sports with nothing live', settings.activeOnly, () => update({ activeOnly: !settings.activeOnly }))}
        {select('Sport order', settings.sportSort, SPORT_SORTS, 'sportSort')}
        {select('Game order', settings.gameSort, GAME_SORTS, 'gameSort')}

        <h4 style={s.h}>Alerts</h4>
        {toggleRow('Alerts', 'Scores, starts and finals for pinned teams, drivers and players', alerts.on, alerts.toggle)}
        {watcher && toggleRow('Background watching', 'Keep watching pins with the app closed (persistent notification)', watcher.on, watcher.toggle)}

        <h4 style={s.h}>Data</h4>
        {toggleRow('Official league APIs first', 'Off = ESPN only. ESPN is always the backup when an official feed fails', settings.officialFirst, () => update({ officialFirst: !settings.officialFirst }))}

        <h4 style={s.h}>Sports ({settings.plugins.length} of {plugins.length} shown)</h4>
        <input
          style={s.search}
          placeholder="Search sports"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search sports"
        />
        {categories.map((cat) => {
          const list = plugins.filter((p) => p.category === cat && matches(p));
          if (!list.length) return null;
          const ids = list.map((p) => p.id);
          const onCount = ids.filter((id) => settings.plugins.includes(id)).length;
          return (
            <details key={cat} style={s.group} open={Boolean(q) || onCount > 0 && ids.length <= 6}>
              <summary style={s.summary}>
                <span>{cat}</span>
                <span style={s.hint}>{onCount}/{ids.length} on</span>
              </summary>
              <div style={s.groupBtns}>
                <button style={s.mini} onClick={() => setPlugins(ids, true)}>All on</button>
                <button style={s.mini} onClick={() => setPlugins(ids, false)}>All off</button>
              </div>
              {list.map((p) => {
                const on = settings.plugins.includes(p.id);
                return (
                  <label key={p.id} style={s.sport}>
                    <input type="checkbox" checked={on} onChange={() => togglePlugin(p.id)} />
                    <span>{p.name}</span>
                  </label>
                );
              })}
            </details>
          );
        })}

        <button style={s.reset} onClick={onReset}>Reset settings to defaults</button>
      </aside>
    </div>
  );
}

const s = {
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 },
  panel: { backgroundColor: '#1e293b', color: '#f8fafc', width: '420px', maxWidth: '100vw', height: '100%', overflowY: 'auto', padding: '20px' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  close: { background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' },
  h: { margin: '20px 0 8px', color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '8px 0', fontSize: '14px' },
  hint: { fontSize: '12px', color: '#94a3b8', fontWeight: 'normal' },
  select: { backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px', padding: '6px 10px' },
  switch: { color: '#fff', border: 'none', borderRadius: '999px', padding: '6px 14px', cursor: 'pointer', fontWeight: 600, minWidth: '56px' },
  search: { width: '100%', boxSizing: 'border-box', backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' },
  group: { backgroundColor: '#0f172a', borderRadius: '8px', padding: '8px 12px', marginBottom: '8px' },
  summary: { cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '14px' },
  groupBtns: { display: 'flex', gap: '8px', margin: '8px 0' },
  mini: { backgroundColor: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' },
  sport: { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', fontSize: '14px', cursor: 'pointer' },
  reset: { marginTop: '20px', width: '100%', backgroundColor: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: '8px', padding: '10px', cursor: 'pointer' },
};
