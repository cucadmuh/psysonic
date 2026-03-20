import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Trash2, RotateCcw } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { useEqStore, EQ_BANDS, BUILTIN_PRESETS } from '../store/eqStore';
import { useThemeStore } from '../store/themeStore';

// ─── Frequency response canvas ────────────────────────────────────────────────

const SAMPLE_RATE = 44100;
const EQ_Q = 1.41;

function biquadPeakResponse(freq: number, centerHz: number, gainDb: number, sampleRate: number): number {
  if (Math.abs(gainDb) < 0.01) return 0;
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const A = Math.pow(10, gainDb / 40);
  const alpha = Math.sin(w0) / (2 * EQ_Q);
  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;
  const w = (2 * Math.PI * freq) / sampleRate;
  const cosW = Math.cos(w), sinW = Math.sin(w);
  const cos2W = Math.cos(2 * w), sin2W = Math.sin(2 * w);
  const numRe = b0 + b1 * cosW + b2 * cos2W;
  const numIm = - b1 * sinW - b2 * sin2W;
  const denRe = a0 + a1 * cosW + a2 * cos2W;
  const denIm = - a1 * sinW - a2 * sin2W;
  const numMag2 = numRe * numRe + numIm * numIm;
  const denMag2 = denRe * denRe + denIm * denIm;
  return 10 * Math.log10(numMag2 / denMag2);
}

function drawCurve(canvas: HTMLCanvasElement, gains: number[], accentColor: string, bgColor: string, textColor: string) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const fMin = 20, fMax = 20000;
  const dbMin = -13, dbMax = 13;
  const padL = 36, padR = 8, padT = 8, padB = 1;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const freqToX = (f: number) =>
    padL + (Math.log10(f / fMin) / Math.log10(fMax / fMin)) * innerW;
  const dbToY = (db: number) =>
    padT + ((dbMax - db) / (dbMax - dbMin)) * innerH;

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // Grid: dB lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  [-12, -6, 0, 6, 12].forEach(db => {
    const y = dbToY(db);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(db === 0 ? '0' : (db > 0 ? `+${db}` : `${db}`), padL - 4, y + 3);
  });

  // Grid: frequency lines
  [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].forEach(f => {
    const x = freqToX(f);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, H - padB);
    ctx.stroke();
  });

  // Zero line (brighter)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, dbToY(0));
  ctx.lineTo(W - padR, dbToY(0));
  ctx.stroke();

  // Frequency response curve
  const points: [number, number][] = [];
  const steps = innerW * 2;
  for (let i = 0; i <= steps; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / steps);
    let totalDb = 0;
    for (let band = 0; band < 10; band++) {
      totalDb += biquadPeakResponse(f, EQ_BANDS[band].freq, gains[band], SAMPLE_RATE);
    }
    totalDb = Math.max(dbMin, Math.min(dbMax, totalDb));
    points.push([freqToX(f), dbToY(totalDb)]);
  }

  // Fill under curve
  const grad = ctx.createLinearGradient(0, padT, 0, H);
  grad.addColorStop(0, accentColor.replace(')', ', 0.25)').replace('rgb', 'rgba'));
  grad.addColorStop(1, accentColor.replace(')', ', 0.0)').replace('rgb', 'rgba'));

  ctx.beginPath();
  ctx.moveTo(points[0][0], dbToY(0));
  points.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(points[points.length - 1][0], dbToY(0));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Curve line
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  points.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

// ─── Custom vertical fader (no native range input) ────────────────────────────

const GAIN_MIN = -12, GAIN_MAX = 12;

interface FaderProps {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}

function VerticalFader({ value, disabled, onChange }: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const gainToPct = (g: number) => (GAIN_MAX - g) / (GAIN_MAX - GAIN_MIN); // 0=top, 1=bottom
  const pctToGain = (p: number) => GAIN_MAX - p * (GAIN_MAX - GAIN_MIN);

  const updateFromY = useCallback((clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const gain = Math.round(pctToGain(pct) / 0.5) * 0.5; // snap to 0.5 dB
    onChange(Math.max(GAIN_MIN, Math.min(GAIN_MAX, gain)));
  }, [onChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    dragging.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    updateFromY(e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || disabled) return;
    updateFromY(e.clientY);
  };

  const onPointerUp = () => { dragging.current = false; };

  const thumbPct = gainToPct(value) * 100;

  return (
    <div
      ref={trackRef}
      className="eq-fader-custom"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ cursor: disabled ? 'default' : 'pointer' }}
    >
      <div className="eq-track-line" />
      <div className="eq-thumb" style={{ top: `${thumbPct}%`, opacity: disabled ? 0.3 : 1 }} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Equalizer() {
  const { t } = useTranslation();
  const gains = useEqStore(s => s.gains);
  const enabled = useEqStore(s => s.enabled);
  const activePreset = useEqStore(s => s.activePreset);
  const customPresets = useEqStore(s => s.customPresets);
  const { setBandGain, setEnabled, applyPreset, saveCustomPreset, deleteCustomPreset } = useEqStore();

  const [saveName, setSaveName] = useState('');
  const [showSave, setShowSave] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const theme = useThemeStore(s => s.theme);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--accent').trim() || 'rgb(203, 166, 247)';
    const bg = style.getPropertyValue('--bg-app').trim() || '#1e1e2e';
    const text = style.getPropertyValue('--text-muted').trim() || 'rgba(255,255,255,0.4)';
    drawCurve(canvas, gains, accent, bg, text);
  }, [gains, theme]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    const ro = new ResizeObserver(redraw);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [redraw]);

  const allPresets = [...BUILTIN_PRESETS, ...customPresets];
  const selectValue = activePreset ?? '__custom__';
  const isCustomSaved = activePreset && !BUILTIN_PRESETS.some(p => p.name === activePreset);

  const handleSave = () => {
    const name = saveName.trim();
    if (!name) return;
    saveCustomPreset(name);
    setSaveName('');
    setShowSave(false);
  };

  return (
    <div className="eq-wrap">
      {/* Controls bar */}
      <div className="eq-controls-bar">
        <label className="eq-toggle-label">
          <span>{t('settings.eqEnabled')}</span>
          <label className="toggle-switch" style={{ marginLeft: 8 }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span className="toggle-track" />
          </label>
        </label>

        <div className="eq-preset-row">
          <CustomSelect
            className="eq-preset-select"
            value={selectValue}
            onChange={v => applyPreset(v)}
            options={[
              ...(activePreset === null ? [{ value: '__custom__', label: t('settings.eqPresetCustom'), disabled: true }] : []),
              ...BUILTIN_PRESETS.map(p => ({ value: p.name, label: p.name, group: t('settings.eqPresetBuiltin') })),
              ...customPresets.map(p => ({ value: p.name, label: p.name, group: t('settings.eqPresetCustomGroup') })),
            ]}
          />

          {isCustomSaved && (
            <button className="eq-ctrl-btn" onClick={() => deleteCustomPreset(activePreset!)} data-tooltip={t('settings.eqDeletePreset')}>
              <Trash2 size={13} />
            </button>
          )}
          <button className="eq-ctrl-btn" onClick={() => applyPreset('Flat')} data-tooltip={t('settings.eqResetBands')}>
            <RotateCcw size={13} />
          </button>
          <button className="eq-ctrl-btn" onClick={() => setShowSave(v => !v)} data-tooltip={t('settings.eqSavePreset')}>
            <Save size={13} />
          </button>
        </div>
      </div>

      {showSave && (
        <div className="eq-save-row">
          <input
            type="text" className="input" placeholder={t('settings.eqPresetName')}
            value={saveName} onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            autoFocus style={{ flex: 1, padding: '6px 12px', fontSize: 13 }}
          />
          <button className="btn btn-primary" onClick={handleSave} disabled={!saveName.trim()}>{t('common.save')}</button>
          <button className="btn btn-ghost" onClick={() => { setShowSave(false); setSaveName(''); }}>{t('common.cancel')}</button>
        </div>
      )}

      {/* EQ panel */}
      <div className={`eq-panel ${!enabled ? 'eq-panel--off' : ''}`}>
        {/* Frequency response */}
        <canvas ref={canvasRef} className="eq-canvas" />

        {/* Fader area */}
        <div className="eq-faders">
          {/* dB scale */}
          <div className="eq-db-scale">
            {[12, 6, 0, -6, -12].map(db => (
              <span key={db} className="eq-db-tick">
                {db > 0 ? `+${db}` : db}
              </span>
            ))}
          </div>

          {/* Bands */}
          {EQ_BANDS.map((band, i) => (
            <div key={band.freq} className="eq-band">
              <span className="eq-gain-val">
                {gains[i] > 0 ? '+' : ''}{gains[i].toFixed(1)}
              </span>
              <div className="eq-fader-track">
                <div className="eq-zero-mark" />
                <VerticalFader
                  value={gains[i]}
                  disabled={!enabled}
                  onChange={v => setBandGain(i, v)}
                />
              </div>
              <span className="eq-freq-label">{band.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
