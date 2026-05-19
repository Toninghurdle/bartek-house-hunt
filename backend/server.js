import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import {
  autoInitializeTelegram,
  startTelegramAuth,
  verifyPhoneCode,
  verifyPassword,
  getConnectionState,
  syncHistory,
  setIo,
  startMonitoring
} from './telegram.js';
import {
  getAllProperties,
  updatePropertyStatus,
  getSetting,
  setSetting,
  getAlertCriteria
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH']
  }
});

const PORT = process.env.PORT || 3000;

// Enable CORS and parsing of JSON bodies
app.use(cors());
app.use(express.json());

// Serve static images from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Link Socket.io to Telegram events
setIo(io);

// API Routes

// Redirect root to frontend dashboard
app.get('/', (req, res) => {
  res.redirect('http://localhost:5173');
});

// Get Telegram connection status and saved credentials details
app.get('/api/status', (req, res) => {
  res.json({
    state: getConnectionState(),
    apiId: getSetting('telegram_api_id', ''),
    phoneNumber: getSetting('telegram_phone', ''),
    targetChatName: getSetting('target_chat_name', 'LBS Apartment Hunt')
  });
});

// Start Telegram auth flow
app.post('/api/auth/start', async (req, res) => {
  const { apiId, apiHash, phoneNumber } = req.body;
  console.log(`POST /api/auth/start: Received request for ${phoneNumber}`);
  if (!apiId || !apiHash || !phoneNumber) {
    console.warn('POST /api/auth/start: Missing apiId, apiHash, or phoneNumber');
    return res.status(400).json({ error: 'apiId, apiHash, and phoneNumber are required' });
  }

  try {
    const result = await startTelegramAuth({ apiId, apiHash, phoneNumber });
    res.json(result);
  } catch (err) {
    console.error('POST /api/auth/start: Exception thrown:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify login code
app.post('/api/auth/verify', async (req, res) => {
  const { code } = req.body;
  console.log(`POST /api/auth/verify: Received request with code "${code}"`);
  if (!code) {
    console.warn('POST /api/auth/verify: Missing verification code');
    return res.status(400).json({ error: 'Verification code is required' });
  }

  try {
    const result = verifyPhoneCode(code);
    console.log('POST /api/auth/verify: verifyPhoneCode returned:', result);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error('POST /api/auth/verify: Exception thrown:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify 2-Step password
app.post('/api/auth/password', async (req, res) => {
  const { password } = req.body;
  console.log('POST /api/auth/password: Received request');
  if (!password) {
    console.warn('POST /api/auth/password: Missing password');
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    const result = verifyPassword(password);
    console.log('POST /api/auth/password: verifyPassword returned:', result);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error('POST /api/auth/password: Exception thrown:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get properties with filters and check if they match criteria
app.get('/api/properties', (req, res) => {
  try {
    const properties = getAllProperties();
    const criteria = getAlertCriteria();

    // Map properties to include custom flags indicating if they match the criteria
    const enrichedProperties = properties.map(prop => {
      // 1. Price check (normalize weekly/nightly to monthly equivalent)
      let monthlyPrice = prop.price || 0;
      if (prop.price) {
        if (prop.price_type === 'nightly') {
          monthlyPrice = prop.price * 30;
        } else if (prop.price_type === 'weekly') {
          monthlyPrice = prop.price * 4.33;
        }
      }
      const matchesPrice = prop.price ? monthlyPrice <= criteria.maxPrice : true;

      // 2. Location check
      let matchesLocation = true;
      if (criteria.preferredLocations && criteria.preferredLocations.length > 0) {
        matchesLocation = criteria.preferredLocations.some(prefLoc => 
          prop.location.toLowerCase().includes(prefLoc.toLowerCase()) ||
          prop.description.toLowerCase().includes(prefLoc.toLowerCase())
        );
      }

      // 3. Excluded keywords check
      let matchesExcluded = false;
      if (criteria.excludedKeywords && criteria.excludedKeywords.length > 0) {
        matchesExcluded = criteria.excludedKeywords.some(exclWord => 
          prop.description.toLowerCase().includes(exclWord.toLowerCase()) ||
          prop.location.toLowerCase().includes(exclWord.toLowerCase())
        );
      }

      const isMatch = matchesPrice && matchesLocation && !matchesExcluded;

      return {
        ...prop,
        isAlertMatch: isMatch
      };
    });

    res.json({
      properties: enrichedProperties,
      criteria
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update property status
app.patch('/api/properties/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  try {
    const success = updatePropertyStatus(id, status);
    if (success) {
      // Notify all connected clients of the status update
      io.emit('property_updated', { propertyId: parseInt(id), isNew: false });
      res.json({ success: true, message: 'Status updated' });
    } else {
      res.status(404).json({ error: 'Property not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get settings (Alert criteria and chat name)
app.get('/api/settings', (req, res) => {
  res.json({
    targetChatName: getSetting('target_chat_name', 'LBS Apartment Hunt'),
    criteria: getAlertCriteria()
  });
});

// Save settings
app.post('/api/settings', async (req, res) => {
  const { targetChatName, criteria } = req.body;

  try {
    if (targetChatName) {
      const oldName = getSetting('target_chat_name');
      if (oldName !== targetChatName) {
        setSetting('target_chat_name', targetChatName);
        // Reset chat ID so it gets re-resolved
        setSetting('target_chat_id', '');
        // Trigger re-monitoring
        startMonitoring();
      }
    }

    if (criteria) {
      setSetting('alert_criteria', JSON.stringify(criteria));
    }

    res.json({ success: true, message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually sync historical messages
app.post('/api/sync', async (req, res) => {
  const { days } = req.body;
  
  if (getConnectionState() !== 'connected') {
    return res.status(400).json({ error: 'Telegram is not connected' });
  }

  try {
    const syncDays = days || 30;
    const result = await syncHistory(syncDays);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket connection event
io.on('connection', (socket) => {
  console.log('Frontend client connected via WebSocket.');
  
  // Send current state immediately
  socket.emit('status_update', { state: getConnectionState() });
  
  socket.on('disconnect', () => {
    console.log('Frontend client disconnected.');
  });
});

// Start Express server & Auto-connect to Telegram if possible
httpServer.listen(PORT, async () => {
  console.log(`Server is running locally at http://localhost:${PORT}`);
  
  // Try to connect automatically with saved session
  await autoInitializeTelegram();
});
