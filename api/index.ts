export default function handler(req: any, res: any) {
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
