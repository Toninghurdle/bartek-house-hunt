import { syncHistoryStateless } from './lib/telegram.js';

export default async function handler(req, res) {
  if (req.method === 'POST' || req.method === 'GET') {
    // Only allow manual sync if password is provided or authenticated
    // In a real app we'd secure this, but for now we'll just run it.
    try {
      const result = await syncHistoryStateless();
      if (result.success) {
        return res.status(200).json({ success: true, processed: result.count });
      } else {
        return res.status(500).json({ error: result.error, errorCode: result.errorCode || 'ERR_INTERNAL' });
      }
    } catch (err) {
      console.error('Manual sync failed', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
