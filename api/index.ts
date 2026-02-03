/**
 * Vercel Serverless Entry Point - Minimal Test
 */

import { Hono } from 'hono';
import { handle } from 'hono/vercel';

const app = new Hono();

app.get('/', (c) => c.json({
  name: 'LP Agent Toolkit',
  version: '2.0.0',
  status: 'running',
  runtime: 'vercel',
}));

app.get('/health', (c) => c.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

export default handle(app);
