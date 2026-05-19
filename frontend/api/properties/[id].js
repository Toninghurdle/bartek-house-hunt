import { updatePropertyStatus } from '../lib/supabase.js';

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'PATCH') {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });

    const success = await updatePropertyStatus(id, status);
    if (!success) return res.status(500).json({ error: 'Failed to update status' });

    return res.status(200).json({ success: true, status });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
