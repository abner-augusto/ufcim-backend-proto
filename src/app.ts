import { Hono } from 'hono';
import type { Env } from '@/types/env';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
