import React, { useEffect, useState, useCallback, useRef } from 'react';
import AlbumCard from '../components/AlbumCard';
import GenreFilterBar from '../components/GenreFilterBar';
import { getAlbumList, getAlbumsByGenre, SubsonicAlbum } from '../api/subsonic';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

type SortType = 'alphabeticalByName' | 'alphabeticalByArtist';

const PAGE_SIZE = 30;
const CURRENT_YEAR = new Date().getFullYear();

async function fetchByGenres(genres: string[]): Promise<SubsonicAlbum[]> {
  const results = await Promise.all(genres.map(g => getAlbumsByGenre(g, 500, 0)));
  const seen = new Set<string>();
  return results.flat().filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
}

export default function Albums() {
  const { t } = useTranslation();
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [sort, setSort] = useState<SortType>('alphabeticalByName');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const observerTarget = useRef<HTMLDivElement>(null);

  const genreFiltered = selectedGenres.length > 0;
  const fromNum = parseInt(yearFrom, 10);
  const toNum = parseInt(yearTo, 10);
  const yearActive = !isNaN(fromNum) && !isNaN(toNum) && fromNum >= 1 && toNum >= 1;

  const load = useCallback(async (
    sortType: SortType,
    offset: number,
    append = false,
    yearFilter?: { from: number; to: number },
  ) => {
    setLoading(true);
    try {
      const extra = yearFilter ? { fromYear: yearFilter.from, toYear: yearFilter.to } : {};
      const type = yearFilter ? 'byYear' : sortType;
      const data = await getAlbumList(type, PAGE_SIZE, offset, extra);
      if (append) setAlbums(prev => [...prev, ...data]);
      else setAlbums(data);
      setHasMore(data.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFiltered = useCallback(async (genres: string[], sortType: SortType) => {
    setLoading(true);
    try {
      const data = await fetchByGenres(genres);
      const sorted = [...data].sort((a, b) =>
        sortType === 'alphabeticalByArtist'
          ? a.artist.localeCompare(b.artist)
          : a.name.localeCompare(b.name)
      );
      setAlbums(sorted);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(0);
    if (genreFiltered) {
      loadFiltered(selectedGenres, sort);
    } else if (yearActive) {
      load(sort, 0, false, { from: fromNum, to: toNum });
    } else {
      load(sort, 0);
    }
  }, [sort, genreFiltered, selectedGenres, yearActive, fromNum, toNum, load, loadFiltered]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || genreFiltered) return;
    const next = page + 1;
    setPage(next);
    const yf = yearActive ? { from: fromNum, to: toNum } : undefined;
    load(sort, next * PAGE_SIZE, true, yf);
  }, [loading, hasMore, page, sort, load, genreFiltered, yearActive, fromNum, toNum]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: '200px' }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [loadMore]);

  const clearYear = () => { setYearFrom(''); setYearTo(''); };

  const sortOptions: { value: SortType; label: string }[] = [
    { value: 'alphabeticalByName',   label: t('albums.sortByName') },
    { value: 'alphabeticalByArtist', label: t('albums.sortByArtist') },
  ];

  return (
    <div className="content-body animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('albums.title')}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {!yearActive && sortOptions.map(o => (
            <button
              key={o.value}
              className={`btn btn-surface ${sort === o.value ? 'btn-sort-active' : ''}`}
              onClick={() => setSort(o.value)}
              style={sort === o.value ? { background: 'var(--accent)', color: 'var(--ctp-crust)' } : {}}
            >
              {o.label}
            </button>
          ))}

          {/* Year range filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {t('albums.yearFilterLabel')}
            </span>
            <input
              className="input"
              type="number"
              min={1900}
              max={CURRENT_YEAR}
              placeholder={t('albums.yearFrom')}
              value={yearFrom}
              onChange={e => setYearFrom(e.target.value)}
              style={{ width: 68, padding: '4px 6px', fontSize: 12 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</span>
            <input
              className="input"
              type="number"
              min={1900}
              max={CURRENT_YEAR}
              placeholder={t('albums.yearTo')}
              value={yearTo}
              onChange={e => setYearTo(e.target.value)}
              style={{ width: 68, padding: '4px 6px', fontSize: 12 }}
            />
            {yearActive && (
              <button
                className="btn btn-ghost"
                onClick={clearYear}
                data-tooltip={t('albums.yearFilterClear')}
                style={{ padding: '4px 6px' }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <GenreFilterBar selected={selectedGenres} onSelectionChange={setSelectedGenres} />
        </div>
      </div>

      {loading && albums.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <div className="spinner" />
        </div>
      ) : (
        <>
          <div className="album-grid-wrap">
            {albums.map(a => <AlbumCard key={a.id} album={a} />)}
          </div>
          {!genreFiltered && (
            <div ref={observerTarget} style={{ height: '20px', margin: '2rem 0', display: 'flex', justifyContent: 'center' }}>
              {loading && hasMore && <div className="spinner" style={{ width: 20, height: 20 }} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
