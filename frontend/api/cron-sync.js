import { syncHistoryStateless } from './lib/telegram.js';

// This is the endpoint Vercel Cron will hit
export default async function handler(req, res) {
  // We can add simple authorization here using a secret token from env
  const authHeader = req.headers.authorization;
  if (
    process.env.CRON_SECRET && 
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await syncHistoryStateless();
    if (result.success) {
      return res.status(200).json({ success: true, processed: result.count });
    } else {
      return res.status(500).json({ error: result.error });
    }
  } catch (err) {
    console.error('Cron sync failed', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
