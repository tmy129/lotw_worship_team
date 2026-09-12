import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_GAS_URL;
const APP_SECRET = import.meta.env.VITE_APP_SECRET || "";
// Public by construction — it is visible in this page's own source, like the
// channel id the web app carries. Committed as the default so a fresh clone
// builds a working portal; VITE_LIFF_ID overrides it for a second LIFF app.
const LIFF_ID = import.meta.env.VITE_LIFF_ID || "2009964527-ukdx60TQ";
const WEB_APP_URL = "https://tmy129.github.io/lotw_worship_team/";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/** "2026-09-20" → "9/20（日）". Parsed as a local date, so the day never slips. */
function fmtWeek(weekId) {
  const [y, m, d] = weekId.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${m}/${d}（${WEEKDAY[date.getDay()]}）`;
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

export default function Portal() {
  const [state, setState] = useState({ status: "loading" });

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

  if (state.status === "loading") {
    return (
      <main className="portal">
        <div className="skeleton-title" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
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

  const { member, mySchedule, weeks } = state.data;
  const rolesByWeek = new Map(mySchedule.map(m => [m.weekId, m.roles]));

  return (
    <main className="portal">
      <header className="portal-head">
        <h1 className="portal-title">我的班表</h1>
        {member ? <p className="portal-who">{member.name}</p> : null}
      </header>

      {member ? (
        mySchedule.length ? (
          <section className="block">
            <h2 className="block-title">接下來的服事</h2>
            <ul className="mine">
              {mySchedule.map(m => (
                <li key={m.weekId}>
                  <span className="mine-week">{fmtWeek(m.weekId)}</span>
                  <span className="mine-roles">{m.roles.join("、")}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="block">
            <p className="empty">目前沒有排到你的服事。</p>
          </section>
        )
      ) : (
        <section className="block">
          <p className="empty">
            這個 LINE 帳號還沒有連結到團員資料，所以看不到個人班表。
          </p>
          <button type="button" className="link-btn" onClick={() => openExternal(WEB_APP_URL)}>
            前往網頁版連結帳號
          </button>
        </section>
      )}

      <section className="block">
        <h2 className="block-title">近期詩歌</h2>
        {weeks.map(w => (
          <article key={w.weekId} className="week">
            <div className="week-head">
              <span className="week-date">{fmtWeek(w.weekId)}</span>
              {rolesByWeek.has(w.weekId) && (
                <span className="week-badge">{rolesByWeek.get(w.weekId).join("、")}</span>
              )}
            </div>
            {w.speaker ? <p className="week-speaker">講員：{w.speaker}</p> : null}
            {w.songs.length ? (
              <ol className="songs">
                {w.songs.map(s => (
                  <li key={s.slot}>
                    {s.youtube ? (
                      <button type="button" className="song-link" onClick={() => openExternal(s.youtube)}>
                        {s.name}
                      </button>
                    ) : (
                      <span>{s.name}</span>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="week-pending">詩歌尚未公告</p>
            )}
          </article>
        ))}
      </section>

      <footer className="portal-foot">
        <p>這裡只顯示資訊。投票、選歌與排班請到網頁版。</p>
        <button type="button" className="link-btn" onClick={() => openExternal(WEB_APP_URL)}>
          開啟網頁版
        </button>
      </footer>
    </main>
  );
}
