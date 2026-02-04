/**
 * Minimal server for Railway testing
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/', (c) => c.json({ 
  name: 'LP Agent Toolkit', 
  status: 'running',
  version: '2.0.0'
}));

app.get('/health', (c) => c.json({ 
  status: 'ok', 
  timestamp: new Date().toISOString() 
}));

const port = parseInt(process.env.PORT || '3456');

console.log(`Starting minimal server on port ${port}...`);

serve({
  fetch: app.fetch,
  port: port,
}, (info) => {
  console.log(`✅ Server running on http://0.0.0.0:${info.port}`);
});
