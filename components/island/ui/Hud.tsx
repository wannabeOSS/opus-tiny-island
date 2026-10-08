"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { audio } from "../lib/audio";
import { SECRETS, forgetSecrets, found, onSecret, type SecretId } from "../lib/secrets";
import { TOOLS, setTool, subscribeTool, toolState, type ToolKind } from "../lib/tools";
import { clearWet } from "../lib/wetmap";
import { WEATHER_ORDER, emit, on, world, type WeatherKind } from "../lib/world";
import { Close, Notebook, Seashell, Speaker, TOOL_ICON, WeatherIcon } from "./icons";
import styles from "./hud.module.css";

const WEATHER_NAME: Record<WeatherKind, string> = {
  clear: "Clear",
  cloudy: "Cloudy",
  rain: "Rain",
  storm: "Storm",
  fog: "Fog",
  snow: "Snow",
};

const FLOW = [
  { id: "pause", label: "pause", v: 0 },
  { id: "gentle", label: "gentle", v: 1 },
  { id: "quick", label: "quick", v: 6 },
];

function mood() {
  const t = world.time;
  const w = world.weather;
  if (world.rainbow > 0.2) return "a rainbow, look";
  if (w === "storm") return "a storm rolls in";
  if (w === "rain") return t > 19 || t < 6 ? "rain on the roof" : "a soft rain";
  if (w === "snow") return "first snow";
  if (w === "fog") return "lost in the fog";
  if (t >= 23.5 || t < 0.5) return "midnight";
  if (t < 5) return "a quiet night";
  if (t < 7) return "first light";
  if (w === "cloudy") return "a grey, gentle day";
  if (t < 11) return "a bright morning";
  if (t < 15) return "a slow afternoon";
  if (t < 17.2) return "late afternoon";
  if (t < 19) return "golden hour";
  if (t < 20.5) return "dusk";
  return "a quiet night";
}

function clock(t: number) {
  const h = Math.floor(t);
  const m = Math.floor((t - h) * 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

type Toast = { id: number; kind: "secret" | "hint"; title: string; body?: string };

export default function Hud() {
  const tool = useSyncExternalStore(subscribeTool, () => toolState.tool, () => "hand" as ToolKind);
  const muted = useSyncExternalStore(
    (l) => audio.subscribe(l),
    () => audio.muted,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState({ mood: mood(), time: world.time, weather: world.weather, night: world.night > 0.55 });
  const [secrets, setSecrets] = useState<SecretId[]>(() => [...found]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [caption, setCaption] = useState<{ tool: ToolKind; n: number } | null>(null);
  const [intro, setIntro] = useState(true);
  const toastId = useRef(0);

  // poll the world a few times a second for the title and the journal
  useEffect(() => {
    const id = setInterval(() => {
      setLive((prev) => {
        const next = { mood: mood(), time: world.time, weather: world.weather, night: world.night > 0.55 };
        if (prev.mood === next.mood && Math.abs(prev.time - next.time) < 0.01 && prev.weather === next.weather && prev.night === next.night) return prev;
        return next;
      });
    }, 300);
    return () => clearInterval(id);
  }, []);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.kind === "secret" ? 6000 : 3800);
  }, []);

  useEffect(() => {
    const offSecret = onSecret((id) => {
      setSecrets([...found]);
      if (!id) return;
      const s = SECRETS.find((x) => x.id === id);
      if (s) pushToast({ kind: "secret", title: s.title, body: s.note });
    });
    const offHint = on("hint", ({ text }) => pushToast({ kind: "hint", title: text }));
    return () => {
      offSecret();
      offHint();
    };
  }, [pushToast]);

  // the onboarding line fades on first touch
  useEffect(() => {
    const done = () => setIntro(false);
    const t = setTimeout(done, 12000);
    window.addEventListener("pointerdown", done, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", done);
    };
  }, []);

  // show what the tool does for a moment after picking it
  useEffect(() => {
    let n = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeTool(() => {
      n++;
      setCaption({ tool: toolState.tool, n });
      clearTimeout(timer);
      timer = setTimeout(() => setCaption(null), 2200);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  // keys: 1-7 tools, w weather, j journal, m mute
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key === e.key);
      if (t) setTool(t.id);
      else if (e.key === "w") cycleWeather();
      else if (e.key === "j") setOpen((o) => !o);
      else if (e.key === "m") audio.setMuted(!audio.muted);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const pick = (id: ToolKind) => {
    audio.start();
    setTool(id);
    emit("sfx", { name: "tick", strength: 0.5, pitch: 1 + TOOLS.findIndex((t) => t.id === id) * 0.06 });
  };

  const begin = () => {
    emit("weather", { kind: "clear" });
    world.time = 17.45;
    world.breeze.set(0, 0);
    clearWet();
    emit("reset", {});
    setTool("hand");
    setOpen(false);
  };


  return (
    <div className={styles.hud} data-night={live.night || undefined}>
      <header className={styles.brand}>
        <h1 className={styles.title}>tiny island</h1>
        <p className={styles.mood} key={live.mood}>
          {live.mood}
        </p>
        {secrets.length > 0 && (
          <button className={styles.found} onClick={() => setOpen(true)}>
            <Seashell size={18} />
            <span>
              {secrets.length} of {SECRETS.length} secrets
            </span>
          </button>
        )}
      </header>

      <div className={styles.corner}>
        <button
          className={styles.round}
          aria-label={muted ? "Turn sound on" : "Mute"}
          title={muted ? "Sound off (m)" : "Sound on (m)"}
          onClick={() => {
            audio.start();
            audio.setMuted(!muted);
          }}
        >
          <Speaker muted={muted} size={26} />
        </button>
        <button className={styles.round} data-on={open || undefined} aria-label="Field notes" title="Field notes (j)" onClick={() => setOpen((o) => !o)}>
          <Notebook size={26} />
        </button>
      </div>

      {open && (
        <Journal
          time={live.time}
          weather={live.weather}
          secrets={secrets}
          onClose={() => setOpen(false)}
          onBegin={begin}
        />
      )}

      <div className={styles.toasts} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={styles.toast} data-kind={t.kind}>
            {t.kind === "secret" && <Seashell size={26} />}
            <div>
              {t.kind === "secret" && <div className={styles.toastEyebrow}>A secret</div>}
              <div className={styles.toastTitle}>{t.title}</div>
              {t.body && <div className={styles.toastBody}>{t.body}</div>}
            </div>
          </div>
        ))}
      </div>

      {intro && (
        <div className={styles.intro}>
          <div className={styles.introBig}>touch anything</div>
          <div className={styles.introSmall}>or pick something from the basket below</div>
        </div>
      )}

      <div className={styles.dock}>
        {caption && (
          <div key={caption.n} className={styles.caption}>
            <b>{TOOLS.find((t) => t.id === caption.tool)?.name}</b>
            <span>{TOOLS.find((t) => t.id === caption.tool)?.verb}</span>
          </div>
        )}
        <nav className={styles.tray} aria-label="Tools">
          {TOOLS.map((t) => {
            const Icon = TOOL_ICON[t.id];
            return (
              <button
                key={t.id}
                className={styles.tool}
                data-active={tool === t.id || undefined}
                aria-pressed={tool === t.id}
                aria-label={t.name}
                onClick={() => pick(t.id)}
              >
                <Icon size={34} />
                <span className={styles.key}>{t.key}</span>
                <span className={styles.tip}>
                  <b>{t.name}</b>
                  <span>{t.verb}</span>
                </span>
              </button>
            );
          })}
          <span className={styles.divider} aria-hidden="true" />
          <button className={styles.tool} aria-label={`Weather: ${WEATHER_NAME[live.weather]}`} onClick={cycleWeather}>
            <WeatherIcon kind={live.weather} size={34} />
            <span className={styles.key}>w</span>
            <span className={styles.tip}>
              <b>{WEATHER_NAME[live.weather]}</b>
              <span>tap to change the sky</span>
            </span>
          </button>
        </nav>
      </div>
    </div>
  );
}

function cycleWeather() {
  const i = WEATHER_ORDER.indexOf(world.weather);
  emit("weather", { kind: WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length] });
}

/* ---------------- journal ---------------- */

function Journal({
  time,
  weather,
  secrets,
  onClose,
  onBegin,
}: {
  time: number;
  weather: WeatherKind;
  secrets: SecretId[];
  onClose: () => void;
  onBegin: () => void;
}) {
  const [flow, setFlow] = useState(world.settings.timeFlow);
  const [wind, setWind] = useState(world.settings.windSense);
  const [waves, setWaves] = useState(world.settings.waves);

  return (
    <aside className={styles.journal} aria-label="Field notes">
      <div className={styles.jHead}>
        <h2>Field notes</h2>
        <button className={styles.close} aria-label="Close" onClick={onClose}>
          <Close size={22} />
        </button>
      </div>

      <section>
        <h3>The sky</h3>
        <div className={styles.chips}>
          {WEATHER_ORDER.map((k) => (
            <button key={k} className={styles.chip} data-on={weather === k || undefined} onClick={() => emit("weather", { kind: k })}>
              <WeatherIcon kind={k} size={22} />
              <span>{WEATHER_NAME[k]}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>The day</h3>
        <div className={styles.dayRow}>
          <DayDial time={time} />
          <div className={styles.dayInfo}>
            <div className={styles.clock}>{clock(time)}</div>
            <div className={styles.dayHint}>drag the sun around the dial</div>
            <div className={styles.segment} role="radiogroup" aria-label="Time flow">
              {FLOW.map((f) => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={flow === f.v}
                  data-on={flow === f.v || undefined}
                  onClick={() => {
                    world.settings.timeFlow = f.v;
                    setFlow(f.v);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3>Air and water</h3>
        <Slider
          label="Wind from your hand"
          value={wind}
          min={0}
          max={2.5}
          words={["still", "a whisper", "breezy", "blustery"]}
          onChange={(v) => {
            world.settings.windSense = v;
            setWind(v);
          }}
        />
        <Slider
          label="Waves"
          value={waves}
          min={0}
          max={2}
          words={["glassy", "lapping", "rolling", "choppy"]}
          onChange={(v) => {
            world.settings.waves = v;
            setWaves(v);
          }}
        />
      </section>

      <section>
        <h3>
          Secrets <span className={styles.count}>{secrets.length} of {SECRETS.length}</span>
        </h3>
        <ul className={styles.secrets}>
          {SECRETS.map((s) => {
            const has = secrets.includes(s.id);
            return (
              <li key={s.id} data-found={has || undefined}>
                <span className={styles.mark}>{has ? <Seashell size={18} /> : <span className={styles.dot} />}</span>
                <div>
                  <div className={styles.sTitle}>{has ? s.title : "???"}</div>
                  <div className={styles.sNote}>{has ? s.note : s.clue}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className={styles.jFoot}>
        <div className={styles.jButtons}>
          <button className={styles.btn} onClick={() => emit("reset", {})}>
            Recenter view
          </button>
          <button className={styles.btn} data-primary onClick={onBegin}>
            Begin again
          </button>
        </div>
        <p className={styles.help}>
          Right-drag or use two fingers to look around.
          <br />
          Scroll or pinch to zoom.
        </p>
        {secrets.length > 0 && (
          <button className={styles.linkBtn} onClick={() => forgetSecrets()}>
            forget the secrets I found
          </button>
        )}
      </footer>
    </aside>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  words,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  words: string[];
  onChange: (v: number) => void;
}) {
  const k = (value - min) / (max - min);
  const word = words[Math.min(words.length - 1, Math.floor(k * words.length))];
  return (
    <label className={styles.slider}>
      <span className={styles.sliderTop}>
        <span>{label}</span>
        <span className={styles.sliderWord}>{word}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        style={{ "--v": `${k * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/* ---------------- day dial ---------------- */

const R = 46;
const C = 62;

function DayDial({ time }: { time: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const t = drag ?? time;
  const phi = (t / 24) * Math.PI * 2;
  const x = C - R * Math.sin(phi);
  const y = C + R * Math.cos(phi);
  const day = t >= 6 && t < 18;

  const fromEvent = (e: RPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * (C * 2) - C;
    const py = ((e.clientY - r.top) / r.height) * (C * 2) - C;
    const a = Math.atan2(-px, py);
    return (((a / (Math.PI * 2)) * 24) % 24 + 24) % 24;
  };
  const set = (e: RPointerEvent) => {
    const nt = fromEvent(e);
    world.time = nt;
    setDrag(nt);
  };

  return (
    <svg
      ref={svg}
      className={styles.dial}
      viewBox={`0 0 ${C * 2} ${C * 2}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        world.draggingTime = true;
        set(e);
      }}
      onPointerMove={(e) => drag !== null && set(e)}
      onPointerUp={() => {
        world.draggingTime = false;
        setDrag(null);
      }}
      onPointerCancel={() => {
        world.draggingTime = false;
        setDrag(null);
      }}
      role="slider"
      aria-label="Time of day"
      aria-valuemin={0}
      aria-valuemax={24}
      aria-valuenow={Math.round(t * 10) / 10}
      aria-valuetext={clock(t)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") world.time = (world.time + 0.25) % 24;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") world.time = (world.time + 23.75) % 24;
      }}
    >
      <defs>
        <clipPath id="dial-clip">
          <circle cx={C} cy={C} r={R + 10} />
        </clipPath>
        <linearGradient id="dial-day" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe3e0" />
          <stop offset="1" stopColor="#ffe2b8" />
        </linearGradient>
        <linearGradient id="dial-night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f4d63" />
          <stop offset="1" stopColor="#1d2c3d" />
        </linearGradient>
      </defs>
      <g clipPath="url(#dial-clip)">
        <rect x="0" y="0" width={C * 2} height={C} fill="url(#dial-day)" />
        <rect x="0" y={C} width={C * 2} height={C} fill="url(#dial-night)" />
        {[[40, 84], [70, 96], [88, 80], [52, 104], [80, 108]].map(([sx, sy], i) => (
          <circle key={i} cx={sx} cy={sy} r={1.1} fill="#fff7e8" opacity={0.8} />
        ))}
        <path d={`M${C - 26} ${C} q 8 -10 16 0 t 16 0 t 16 0`} fill="none" stroke="#3d8c86" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      </g>
      <circle cx={C} cy={C} r={R + 10} fill="none" stroke="#24332f" strokeWidth="2" />
      <circle cx={C} cy={C} r={R} fill="none" stroke="#24332f" strokeWidth="1.2" strokeDasharray="2 5" opacity="0.5" />
      <line x1={C - R - 10} y1={C} x2={C + R + 10} y2={C} stroke="#24332f" strokeWidth="1.5" />
      {day ? (
        <g transform={`translate(${x} ${y})`}>
          <circle r="12" fill="#f2c14e" opacity="0.35" />
          <circle r="8" fill="#f2c14e" stroke="#24332f" strokeWidth="2" />
        </g>
      ) : (
        <g transform={`translate(${x} ${y})`}>
          <circle r="12" fill="#fff7e8" opacity="0.18" />
          <path d="M3 -7.5 A8 8 0 1 0 3 7.5 A6 6 0 1 1 3 -7.5z" fill="#fff7e8" stroke="#24332f" strokeWidth="2" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
