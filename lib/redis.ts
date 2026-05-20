import Redis from 'ioredis';

// Singleton across Next.js hot-module reloads (same pattern as globalThis scheduler)
declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | undefined;
}

function createClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 2000,
    lazyConnect: true,
    // Vercel serverless requires explicit TLS options for rediss:// URLs
    ...(url.startsWith('rediss://') ? { tls: {} } : {}),
  });
  client.on('error', (err) => {
    // Non-fatal: in-memory fallback kicks in when Redis is unavailable
    if (process.env.NODE_ENV !== 'test') {
      process.stderr.write(`[redis] connection error: ${err.message}\n`);
    }
  });
  return client;
}

export function getRedis(): Redis {
  if (!globalThis.__redisClient) {
    globalThis.__redisClient = createClient();
  }
  return globalThis.__redisClient;
}

export async function closeRedis(): Promise<void> {
  if (globalThis.__redisClient) {
    await globalThis.__redisClient.quit();
    globalThis.__redisClient = undefined;
  }
}
