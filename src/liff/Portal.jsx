import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_GAS_URL;
const APP_SECRET = import.meta.env.VITE_APP_SECRET || "";
// Public by construction — it is visible in this page's own source, like the
// channel id the web app carries. Committed as the default so a fresh clone
// builds a working portal; VITE_LIFF_ID overrides it for a second LIFF app.
const LIFF_ID = import.meta.env.VITE_LIFF_ID || "2009964527-ukdx60TQ";
const WEB_APP_URL = "https://tmy129.github.io/lotw_worship_team/";

const MONTH_ZH = ["", "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月"];

/** "2026-09-12" → "2026年9月12日", matching the full app's card heading. */
function fullDate(weekId) {
  const m = weekId.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日` : weekId;
}

/**
 * The portal reads one action and nothing else. There is no write path here on
 * purpose: voting, song submission and schedule edits stay in the full web app.
 */
async function fetchPortalData(idToken) {
  const qs = new URLSearchParams({ action: "getPortalData", secret: APP_SECRET, idToken });
  const res = await fetch(`${API_URL}?${qs}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

/** The LINE in-app browser, detectable before liff.init() has run. */
const inLineApp = () => /\bLine\//i.test(navigator.userAgent);

/**
 * Resolves the viewer's LIFF ID token, or a reason it cannot.
 *
 * The two failure audiences are kept apart. Outside LINE — someone who found the
 * URL in a browser — the only useful answer is where the page belongs, so an
 * init failure there is reported as that rather than leaking configuration
 * detail. Inside LINE the same failure is a real misconfiguration and is named,
 * because a portal that quietly renders an anonymous view would hide it.
 *
 * We deliberately never call liff.login(): the portal is a rich-menu
 * destination, and bouncing a browser visitor into a LINE sign-in is more
 * confusing than telling them to use the menu.
 */
async function resolveIdToken() {
  const fromLine = "請從 LINE 的圖文選單開啟「我的班表」。";
  if (!window.liff) return { error: fromLine };
  if (!LIFF_ID) return { error: "LIFF ID 未設定，請聯絡管理員。" };

  try {
    await window.liff.init({ liffId: LIFF_ID });
  } catch (e) {
    return { error: inLineApp() ? `LINE 初始化失敗：${e?.message || e}` : fromLine };
  }

  if (!window.liff.isLoggedIn()) return { error: fromLine };

  const idToken = window.liff.getIDToken?.() ?? window.liff.getIdToken?.();
  if (!idToken) {
    return {
      error: inLineApp()
        ? "沒有取得 LINE 身分資訊（LIFF 可能未開啟 openid 權限），請聯絡管理員。"
        : fromLine,
    };
  }
  return { idToken };
}

function openExternal(url) {
  if (window.liff?.isInClient?.()) window.liff.openWindow({ url, external: true });
  else window.open(url, "_blank", "noopener");
}

/**
 * One week, one card: the speaker, the songs, and — when the viewer serves that
 * week — the roles they hold, marked on the week itself. A rich menu is asked
 * "what is happening on the 12th and am I on", which a schedule list above a
 * song list makes the reader assemble for themselves.
 */
function WeekCard({ weekId, speaker, songs, roles, past }) {
  const serving = roles.length > 0;
  return (
    <div className={`wk${past ? " wk-past" : ""}`}>
      <div className="wk-hd">
        <div>
          {serving && !past && <div className="wk-eyebrow">即將服事</div>}
          <div className="wk-date">{fullDate(weekId)}</div>
        </div>
        {serving && (
          <div className="wk-chips">
            {roles.map(r => <span key={r} className="chip chip-gold">{r}</span>)}
          </div>
        )}
      </div>
      <div className="wk-bd">
        {speaker && (
          <div className="wk-speaker">
            <span aria-hidden="true">🙏</span>
            <span>講員：<strong>{speaker}</strong></span>
          </div>
        )}
        <div className="wk-label">本週詩歌</div>
        {songs.length ? (
          songs.map(s => (
            <div key={s.slot} className="song">
              <span className="song-name">{s.name}</span>
              {s.youtube && (
                <button type="button" className="yt" onClick={() => openExternal(s.youtube)}>
                  YouTube
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="song-none">尚未公佈</div>
        )}
      </div>
    </div>
  );
}

export default function Portal() {
  const [state, setState] = useState({ status: "loading" });
  // null until the viewer steps months; the shown month is derived, not stored,
  // so arriving data cannot trigger a second render to pick a default.
  const [chosenMonth, setChosenMonth] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { idToken, error } = await resolveIdToken();
      if (!alive) return;
      if (error) return setState({ status: "outside", message: error });
      try {
        const data = await fetchPortalData(idToken);
        if (alive) setState({ status: "ready", data });
      } catch (e) {
        if (alive) setState({ status: "failed", message: e?.message || String(e) });
      }
    })();
    return () => { alive = false; };
  }, []);

  const weeks = state.data?.weeks;
  const months = useMemo(
    () => [...new Set((weeks ?? []).map(w => w.weekId.slice(0, 7)))],
    [weeks],
  );

  // Opens on the current month, or the nearest one the calendar actually has.
  const month = chosenMonth ?? (() => {
    if (!months.length) return "";
    const now = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }).slice(0, 7);
    return months.find(m => m >= now) ?? months[months.length - 1];
  })();

  if (state.status === "loading") {
    return (
      <main className="portal">
        <div className="sk-title" />
        <div className="sk-card" />
        <div className="sk-card" />
      </main>
    );
  }

  if (state.status === "outside" || state.status === "failed") {
    return (
      <main className="portal">
        <h1 className="portal-title">我的班表</h1>
        <div className="notice">
          <p>{state.message}</p>
          {state.status === "outside" && (
            <p className="notice-sub">LOTW 敬拜團 · 從 LINE 官方帳號的圖文選單進入</p>
          )}
        </div>
      </main>
    );
  }

  const { member, mySchedule } = state.data;
  const rolesByWeek = new Map(mySchedule.map(m => [m.weekId, m.roles]));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const monthWeeks = (weeks ?? []).filter(w => w.weekId.startsWith(month));
  const ahead = monthWeeks.filter(w => w.weekId >= today);
  const done = monthWeeks.filter(w => w.weekId < today);
  // Stepped from the previous value rather than from this render's index, so two
  // quick taps move two months instead of colliding on one stale index.
  const step = delta => setChosenMonth(prev => {
    const i = months.indexOf(prev ?? month);
    return months[i + delta] ?? months[i] ?? month;
  });
  const idx = months.indexOf(month);

  const card = (w, past) => (
    <WeekCard key={w.weekId} weekId={w.weekId} speaker={w.speaker} songs={w.songs}
      roles={rolesByWeek.get(w.weekId) ?? []} past={past} />
  );

  return (
    <main className="portal">
      <header className="portal-head">
        <h1 className="portal-title">我的班表</h1>
        <div className="month-nav">
          <button type="button" className="step" disabled={idx <= 0}
            onClick={() => step(-1)} aria-label="上個月">‹</button>
          <span className="month-label">{MONTH_ZH[parseInt(month.slice(5, 7), 10)] || month}</span>
          <button type="button" className="step" disabled={idx >= months.length - 1}
            onClick={() => step(1)} aria-label="下個月">›</button>
        </div>
      </header>

      {member ? null : (
        <div className="notice notice-inline">
          <p>這個 LINE 帳號還沒有連結到團員資料，所以看不到個人服事標記。</p>
          <button type="button" className="link-btn" onClick={() => openExternal(WEB_APP_URL)}>
            前往網頁版連結帳號
          </button>
        </div>
      )}

      {monthWeeks.length === 0 ? (
        <div className="empty">本月沒有排班資料</div>
      ) : (
        <>
          {ahead.map(w => card(w, false))}
          {done.length > 0 && (
            <>
              {ahead.length > 0 && <div className="done-label">已完成</div>}
              {done.map(w => card(w, true))}
            </>
          )}
        </>
      )}

      <footer className="portal-foot">
        <p>這裡只顯示資訊。投票、選歌與排班請到網頁版。</p>
        <button type="button" className="link-btn" onClick={() => openExternal(WEB_APP_URL)}>
          開啟網頁版
        </button>
      </footer>
    </main>
  );
}
