// Vercel Function: tüm /api/* istekleri buraya yönlendirilir (vercel.json → rewrites).
// Uygulama soğuk başlangıçta bir kez kurulur, sıcak çağrılarda yeniden kullanılır.

import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import { createApp } from "../server/app.js";
import { configFromEnv, ConfigError } from "../server/config.js";

let appPromise: ReturnType<typeof createApp> | null = null;

function getApp() {
  appPromise ??= createApp({ ...configFromEnv(), defer: waitUntil }).catch((e) => {
    appPromise = null; // bir sonraki istekte yeniden dene
    throw e;
  });
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const { app } = await getApp();
    app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
  } catch (e) {
    console.error("startup failed", e);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      error: e instanceof ConfigError ? `Sunucu yapılandırması eksik: ${e.message}` : "Sunucu başlatılamadı.",
    }));
  }
}
