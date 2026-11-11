import type { Config } from '@netlify/functions';
import { createHandler } from './lib/handler';
import { MongoRepo } from './lib/mongoRepo';
import { createFileRepo } from './lib/fileRepo';

let handler: ReturnType<typeof createHandler> | null = null;

export default async (req: Request): Promise<Response> => {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET ?? (process.env.NETLIFY_DEV ? 'local-dev-secret' : undefined);
  const localDev = process.env.NETLIFY_DEV === 'true';

  // Zero-setup local mode => JSON-file store (.data/dev-store.json). Never used in production.
  // LOCAL_STORE=1 forces it even when a .env with a real MONGODB_URI is present.
  const useFile = localDev && (process.env.LOCAL_STORE === '1' || !uri);
  if (!uri && !localDev) {
    return Response.json({ error: 'Server is not configured (MONGODB_URI missing).' }, { status: 500 });
  }
  if (!secret) return Response.json({ error: 'Server is not configured (SESSION_SECRET missing).' }, { status: 500 });

  try {
    if (!handler) {
      if (useFile) console.warn('[dev] using local file store at .data/dev-store.json (not MongoDB)');
      handler = createHandler({ repo: useFile || !uri ? createFileRepo('.data/dev-store.json') : await MongoRepo.connect(uri), secret });
    }
  } catch (e) {
    console.error('DB connection failed', e);
    return Response.json({ error: 'Database is unavailable. Please try again shortly.' }, { status: 503 });
  }
  return handler(req);
};

export const config: Config = { path: '/api/*' };
