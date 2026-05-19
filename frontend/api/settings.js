import { getSetting, setSetting } from './lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const alertCriteriaStr = await getSetting('alert_criteria');
    let alertCriteria = {
      maxPrice: 2000,
      preferredLocations: [],
      excludedKeywords: []
    };
    if (alertCriteriaStr) {
      try {
        alertCriteria = JSON.parse(alertCriteriaStr);
      } catch (e) {}
    }
    return res.status(200).json(alertCriteria);
  }

  if (req.method === 'POST') {
    await setSetting('alert_criteria', JSON.stringify(req.body));
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
