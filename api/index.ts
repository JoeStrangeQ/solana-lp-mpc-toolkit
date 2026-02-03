import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const path = req.url || '/';
  
  if (path.includes('/health')) {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }
  
  return res.json({
    name: 'LP Agent Toolkit',
    version: '2.0.0',
    status: 'running',
    runtime: 'vercel-native',
  });
}
