// Vercel fonksiyonunu (api/index.ts) yerelde düz bir HTTP sunucusu arkasında çalıştırır.
// Böylece Vercel'deki istek yolu (handler → Express) duman testiyle denenebilir.
// Kullanım: npx tsx tests/e2e/vercel-handler.ts <port>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import handler from "../../api/index.js";

const port = Number(process.argv[2] ?? 8788);
const dist = path.resolve("web/dist");
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

http.createServer((req, res) => {
  if (req.url?.startsWith("/api/")) return void handler(req, res);
  // Vercel CDN'in yaptığı gibi statik dosyaları sun
  const file = path.join(dist, decodeURIComponent((req.url ?? "/").split("?")[0]));
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, "index.html");
  res.setHeader("Content-Type", types[path.extname(target)] ?? "application/octet-stream");
  fs.createReadStream(target).pipe(res);
}).listen(port, () => console.log(`vercel handler: http://localhost:${port}`));
