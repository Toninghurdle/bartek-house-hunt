export default function handler(req, res) {
  if (req.method === 'POST') {
    const { password } = req.body;
    
    // Check against env variable
    if (password === process.env.DASHBOARD_PASSWORD) {
      return res.status(200).json({ success: true });
    } else {
      return res.status(401).json({ success: false, error: 'Incorrect password' });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}
