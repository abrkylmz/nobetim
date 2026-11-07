// Yerel geliştirme / kendi sunucunda çalıştırma girişi. Vercel'de api/index.ts kullanılır.
import fs from "node:fs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const { createApp } = await import("./app.js");
const { configFromEnv } = await import("./config.js");

const port = Number(process.env.PORT ?? 8787);
const config = configFromEnv();
const { app } = await createApp({ ...config, cleanupInterval: true });

app.listen(port, () => {
  console.log(`Nöbetim: http://localhost:${port}`);
  if (!config.ai.available) console.warn("UYARI: ANTHROPIC_API_KEY tanımlı değil. Fotoğraf ve taranmış PDF okuma devre dışı.");
});
