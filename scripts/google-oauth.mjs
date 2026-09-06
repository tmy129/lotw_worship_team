// One-time consent flow that turns a Google OAuth client into a refresh token.
//
//   node scripts/google-oauth.mjs
//
// The calendar is owned by a personal Gmail account, which has no Workspace
// admin console and therefore cannot grant a service account the domain-wide
// delegation it would need to invite attendees. So the Worker acts as the
// calendar's owner instead, using a refresh token obtained here once.
//
// Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from workers/.dev.vars and
// appends GOOGLE_REFRESH_TOKEN to the same file. The token never passes through
// a terminal argument or the clipboard: the browser redirects to a loopback
// server this script runs, which exchanges the code itself.

import fs from "node:fs";
import http from "node:http";

const VARS = "workers/.dev.vars";
const PORT = 8788;
const REDIRECT = `http://127.0.0.1:${PORT}`;
// Narrowest scope that can create and update events on the owner's calendar.
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

const vars = Object.fromEntries(
  fs.readFileSync(VARS, "utf8").split("\n").filter(Boolean).map(l => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
  if (!vars[key]) {
    console.error(`${key} is not in ${VARS}. Create a Desktop-app OAuth client first.`);
    process.exit(1);
  }
}

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: vars.GOOGLE_CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPE,
  // Both are required to be handed a refresh token rather than only an access
  // token: offline asks for one, consent forces a fresh one even if this
  // account has approved the app before.
  access_type: "offline",
  prompt: "consent",
})}`;

console.log("在瀏覽器開啟這個網址，用日曆擁有者的帳號登入並允許：\n");
console.log(authUrl);
console.log(`\n等待授權回呼 ${REDIRECT} …`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const reply = (msg) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<meta charset="utf-8"><body style="font-family:system-ui;padding:40px">${msg}</body>`);
  };

  if (error) { reply(`授權被拒絕：${error}`); console.error("授權被拒絕:", error); server.close(); return; }
  if (!code) { reply("等待授權…"); return; }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: vars.GOOGLE_CLIENT_ID,
      client_secret: vars.GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const data = await tokenRes.json();

  if (!data.refresh_token) {
    reply("沒有拿到 refresh token，請看終端機訊息。");
    console.error("\n沒有 refresh token。回應：", JSON.stringify(data, null, 2));
    console.error("若這個帳號先前已授權過同一個 client，請到 https://myaccount.google.com/permissions 移除後重試。");
    server.close();
    process.exit(1);
  }

  fs.appendFileSync(VARS, `GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
  reply("已取得授權，可以關閉這個分頁。");
  console.log(`\n✓ refresh token 已寫入 ${VARS}（長度 ${data.refresh_token.length}）`);
  console.log(`  取得的權限範圍：${data.scope}`);
  server.close();
});

server.listen(PORT, "127.0.0.1");
