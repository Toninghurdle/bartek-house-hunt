export default async function handler(req, res) {
  if (req.method === 'POST' || req.method === 'GET') {
    try {
      // Dynamic import catches module resolution errors like ERR_MODULE_NOT_FOUND
      const { syncHistoryStateless } = await import('./lib/telegram.js');
      
      const result = await syncHistoryStateless();
      if (result.success) {
        return res.status(200).json({ success: true, processed: result.count, pending: result.pending });
      } else {
        return res.status(500).json({ error: result.error, errorCode: result.errorCode || 'ERR_INTERNAL' });
      }
    } catch (err) {
      console.error('Manual sync failed', err);
      // Expose the actual module loading error
      return res.status(500).json({ 
        error: err.message || 'Internal Server Error', 
        errorCode: err.code || 'ERR_CRASH' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
