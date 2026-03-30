import React, { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getGenres } from '../api/subsonic';

interface GenreFilterBarProps {
  selected: string[];
  onSelectionChange: (selected: string[]) => void;
}

export default function GenreFilterBar({ selected, onSelectionChange }: GenreFilterBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [genres, setGenres] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getGenres().then(data =>
      setGenres(data.map(g => g.value).sort((a, b) => a.localeCompare(b)))
    );
  }, []);

  // close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // sync open state with selection
  useEffect(() => {
    if (selected.length > 0) setOpen(true);
  }, [selected]);

  const filteredOptions = genres.filter(
    g => !selected.includes(g) && g.toLowerCase().includes(search.toLowerCase())
  );

  const add = (genre: string) => {
    onSelectionChange([...selected, genre]);
    setSearch('');
    inputRef.current?.focus();
  };

  const remove = (genre: string) => {
    onSelectionChange(selected.filter(s => s !== genre));
  };

  const clear = () => {
    onSelectionChange([]);
    setSearch('');
    setOpen(false);
    setDropdownOpen(false);
  };

  const openFilter = () => {
    setOpen(true);
    setTimeout(() => { inputRef.current?.focus(); setDropdownOpen(true); }, 30);
  };

  if (!open) {
    return (
      <button className="btn btn-surface" onClick={openFilter} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Filter size={14} />
        {t('common.filterGenre')}
      </button>
    );
  }

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // relatedTarget is the next focused element; if it's outside our container, handle close
    const next = e.relatedTarget as Node | null;
    if (containerRef.current && next && containerRef.current.contains(next)) return;
    setTimeout(() => {
      if (selected.length === 0) {
        setOpen(false);
        setSearch('');
        setDropdownOpen(false);
      } else {
        setDropdownOpen(false);
      }
    }, 150);
  };

  return (
    <div ref={containerRef} onBlur={handleBlur} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <Filter size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />

      <div className="genre-filter-tagbox">
        {selected.map(g => (
          <span key={g} className="genre-filter-chip">
            {g}
            <button onClick={() => remove(g)} aria-label={`Remove ${g}`}>
              <X size={11} />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          className="genre-filter-input"
          placeholder={selected.length === 0 ? t('common.filterSearchGenres') : ''}
          value={search}
          onChange={e => { setSearch(e.target.value); setDropdownOpen(true); }}
          onFocus={() => setDropdownOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') { setDropdownOpen(false); e.currentTarget.blur(); }
            if (e.key === 'Backspace' && search === '' && selected.length > 0) {
              remove(selected[selected.length - 1]);
            }
          }}
        />

        {dropdownOpen && filteredOptions.length > 0 && (
          <div className="genre-filter-dropdown" onWheel={e => e.stopPropagation()}>
            {filteredOptions.slice(0, 60).map(g => (
              <div key={g} className="genre-filter-option" onMouseDown={() => add(g)}>
                {g}
              </div>
            ))}
          </div>
        )}

        {dropdownOpen && filteredOptions.length === 0 && search.length > 0 && (
          <div className="genre-filter-dropdown" onWheel={e => e.stopPropagation()}>
            <div className="genre-filter-empty">{t('common.filterNoGenres')}</div>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <button className="btn btn-ghost" onClick={clear} style={{ padding: '0.35rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
          <X size={13} />
          {t('common.filterClear')}
        </button>
      )}
    </div>
  );
}
