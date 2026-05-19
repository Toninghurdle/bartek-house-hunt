import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { getSetting, setSetting, upsertProperty } from './db.js';
import { parsePropertyMessage } from './gemini.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');

// Global telegram client reference and connection states
let client = null;
let connectionState = 'disconnected'; // disconnected, connecting, needs_code, connected, error
let phoneCodeDeferred = null;
let passwordDeferred = null;
let ioInstance = null; // Socket.io instance for real-time push

// Ensure uploads directory exists
async function ensureUploadsDir() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create uploads directory:', err);
  }
}

export function setIo(io) {
  ioInstance = io;
}

export function getConnectionState() {
  return connectionState;
}

// Auto-initialize if session exists
export async function autoInitializeTelegram() {
  const sessionStr = getSetting('telegram_session');
  const apiIdStr = getSetting('telegram_api_id');
  const apiHash = getSetting('telegram_api_hash');

  if (sessionStr && apiIdStr && apiHash) {
    console.log('Saved session found, connecting to Telegram automatically...');
    const apiId = parseInt(apiIdStr);
    const session = new StringSession(sessionStr);
    
    client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    connectionState = 'connecting';

    try {
      await client.connect();
      connectionState = 'connected';
      console.log('Telegram client connected successfully using saved session.');
      
      // Start listening to the target chat
      startMonitoring();
    } catch (err) {
      console.error('Auto-connection to Telegram failed:', err);
      connectionState = 'error';
    }
  } else {
    console.log('No saved Telegram session found. Awaiting authentication via dashboard.');
  }
}

// Start Telegram authentication flow
export async function startTelegramAuth({ apiId, apiHash, phoneNumber }) {
  console.log(`Starting Telegram auth flow for ${phoneNumber} (API ID: ${apiId})...`);
  if (client) {
    try {
      await client.disconnect();
    } catch (e) {}
  }

  const session = new StringSession('');
  client = new TelegramClient(session, parseInt(apiId), apiHash, {
    connectionRetries: 5,
  });

  connectionState = 'connecting';

  // We run client.start in the background because it blocks waiting for phone code resolver
  client.start({
    phoneNumber: async () => phoneNumber,
    phoneCode: async () => {
      console.log('GramJS: phoneCode callback triggered. Waiting for code entry from dashboard...');
      connectionState = 'needs_code';
      if (ioInstance) {
        ioInstance.emit('status_update', { state: 'needs_code' });
      }
      return new Promise((resolve) => {
        phoneCodeDeferred = resolve;
      });
    },
    password: async () => {
      console.log('GramJS: password callback triggered (2-Step Verification active). Waiting for password entry from dashboard...');
      connectionState = 'needs_password';
      if (ioInstance) {
        ioInstance.emit('status_update', { state: 'needs_password' });
      }
      return new Promise((resolve) => {
        passwordDeferred = resolve;
      });
    },
    onError: (err) => {
      console.error('Telegram client.start onError event:', err);
      connectionState = 'error';
      if (ioInstance) {
        ioInstance.emit('status_update', { state: 'error', error: err.message });
      }
    }
  }).then(async () => {
    connectionState = 'connected';
    console.log('Telegram client authenticated successfully.');
    
    // Save session in settings
    const sessionStr = client.session.save();
    setSetting('telegram_session', sessionStr);
    setSetting('telegram_api_id', apiId);
    setSetting('telegram_api_hash', apiHash);
    setSetting('telegram_phone', phoneNumber);

    if (ioInstance) {
      ioInstance.emit('status_update', { state: 'connected' });
    }

    // Start monitoring
    startMonitoring();
  }).catch((err) => {
    console.error('Auth flow promise catch block failed:', err);
    connectionState = 'error';
    if (ioInstance) {
      ioInstance.emit('status_update', { state: 'error', error: err.message });
    }
  });

  return { success: true, message: 'Authentication process started' };
}

// Submit verification code
export function verifyPhoneCode(code) {
  console.log(`verifyPhoneCode() called with code: "${code}"`);
  if (phoneCodeDeferred) {
    console.log('Resolving phoneCodeDeferred promise with code.');
    phoneCodeDeferred(code);
    phoneCodeDeferred = null;
    return { success: true, message: 'Code submitted to Telegram' };
  }
  console.warn('verifyPhoneCode() called, but phoneCodeDeferred is null!');
  return { success: false, error: 'No active authentication waiting for code' };
}

// Submit 2-Step password
export function verifyPassword(password) {
  console.log(`verifyPassword() called.`);
  if (passwordDeferred) {
    console.log('Resolving passwordDeferred promise with password.');
    passwordDeferred(password);
    passwordDeferred = null;
    return { success: true, message: 'Password submitted to Telegram' };
  }
  console.warn('verifyPassword() called, but passwordDeferred is null!');
  return { success: false, error: 'No active authentication waiting for password' };
}

// Scan dialogs to find target chat ID
export async function findTargetChatId(groupName = 'LBS Apartment Hunt') {
  if (!client || connectionState !== 'connected') {
    throw new Error('Telegram client is not connected');
  }

  console.log(`Scanning dialogs for group named "${groupName}"...`);
  const dialogs = await client.getDialogs();
  
  for (const dialog of dialogs) {
    if (dialog.title && dialog.title.trim().toLowerCase() === groupName.trim().toLowerCase()) {
      console.log(`Found chat "${dialog.title}" with ID: ${dialog.id}`);
      return dialog.id.toString();
    }
  }

  console.log(`Could not find a group chat named "${groupName}". Please ensure you are a member of it.`);
  return null;
}

// Download media from a message and return the local static path
async function downloadMessageMedia(message) {
  if (!message.media) return null;
  
  await ensureUploadsDir();

  try {
    console.log(`Downloading media for message ${message.id}...`);
    const buffer = await client.downloadMedia(message);
    if (!buffer) return null;

    // Try to determine extension
    let ext = 'jpg';
    if (message.media.document) {
      const mime = message.media.document.mimeType;
      if (mime) {
        const parts = mime.split('/');
        if (parts.length > 1) ext = parts[1];
      }
    }

    const fileName = `media_${message.id}_${Date.now()}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, fileName);
    
    await fs.writeFile(filePath, buffer);
    console.log(`Media saved to ${filePath}`);
    
    // Return the URL relative path
    return `/uploads/${fileName}`;
  } catch (err) {
    console.error('Error downloading message media:', err);
    return null;
  }
}

// Process a single Telegram message (New message or history item)
export async function processTelegramMessage(message) {
  try {
    // Ignore empty messages
    if (!message.text || message.text.trim() === '') return;

    console.log(`Processing message ${message.id} from sender ${message.senderId}...`);

    // Extract sender details
    let senderName = 'Unknown';
    let senderPhone = '';
    
    try {
      const sender = await message.getSender();
      if (sender) {
        senderName = sender.firstName || sender.username || 'Unknown';
        if (sender.lastName) senderName += ' ' + sender.lastName;
        senderPhone = sender.phone || '';
      }
    } catch (e) {
      console.error('Error getting sender info:', e);
    }

    // 1. Download media if present
    const imagePaths = [];
    if (message.media) {
      const imgPath = await downloadMessageMedia(message);
      if (imgPath) imagePaths.push(imgPath);
    }

    // Download other media in the same album if groupedId is present
    if (message.groupedId) {
      try {
        console.log(`Message ${message.id} is part of album (groupedId: ${message.groupedId.toString()}). Fetching album messages...`);
        const targetChatId = getSetting('target_chat_id');
        if (targetChatId) {
          const entity = await client.getInputEntity(targetChatId);
          // Fetch surrounding messages (album is usually 2-10 messages)
          // We fetch 15 messages around the current message ID
          const surrounding = await client.getMessages(entity, {
            limit: 15,
            offsetId: message.id + 5
          });
          
          for (const otherMsg of surrounding) {
            if (otherMsg.id !== message.id && 
                otherMsg.groupedId && 
                otherMsg.groupedId.toString() === message.groupedId.toString() &&
                otherMsg.media) {
              console.log(`Downloading album media from message ${otherMsg.id}...`);
              const imgPath = await downloadMessageMedia(otherMsg);
              if (imgPath) imagePaths.push(imgPath);
            }
          }
        }
      } catch (e) {
        console.error('Error fetching album messages:', e);
      }
    }

    // 2. Parse details using Gemini (or fallback regex)
    const parsed = await parsePropertyMessage(message.text);

    if (parsed.is_property_listing) {
      const propertyData = {
        original_message_id: message.id,
        sender_name: senderName,
        sender_phone: senderPhone,
        price: parsed.price,
        currency: parsed.currency,
        location: parsed.location,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        description: parsed.description,
        date_posted: new Date(message.date * 1000).toISOString(),
        status: parsed.status || 'available',
        image_paths: imagePaths,
        tags: parsed.tags,
        raw_message: message.text,
        price_type: parsed.price_type || 'monthly'
      };

      const result = upsertProperty(propertyData);
      console.log(`Property upserted. ID: ${result.id}, isNew: ${result.isNew}`);

      if (ioInstance) {
        // Emit update to the frontend
        ioInstance.emit('property_updated', { propertyId: result.id, isNew: result.isNew });
      }
    } else {
      console.log(`Message ${message.id} parsed as non-listing.`);
    }
  } catch (err) {
    console.error(`Failed to process message ${message.id}:`, err);
  }
}

// Start monitoring events on Telegram
let isMonitoring = false;
export async function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;

  try {
    let targetChatId = getSetting('target_chat_id');
    
    // If we don't have chat ID, search for it
    if (!targetChatId) {
      const groupName = getSetting('target_chat_name', 'LBS Apartment Hunt');
      targetChatId = await findTargetChatId(groupName);
      if (targetChatId) {
        setSetting('target_chat_id', targetChatId);
      }
    }

    if (!targetChatId) {
      console.warn('Could not monitor chat: Target Chat ID is not resolved yet.');
      isMonitoring = false;
      return;
    }

    console.log(`Monitoring Telegram chat ID: ${targetChatId} for new messages...`);

    // Set up NewMessage handler
    client.addEventHandler(async (event) => {
      const message = event.message;
      
      // Filter out if not from target chat
      // GramJS peer entities can be peerChannel, peerChat, peerUser. We check peer's ID.
      const peerId = message.peerId;
      let peerStrId = '';
      if (peerId) {
        peerStrId = (peerId.channelId || peerId.chatId || peerId.userId || '').toString();
      }

      const matchId = targetChatId.replace('-100', '').replace('-', '');
      const cleanPeerId = peerStrId.toString();

      if (cleanPeerId.includes(matchId) || targetChatId.includes(cleanPeerId)) {
        console.log(`New message received in LBS Apartment Hunt: "${message.text}"`);
        await processTelegramMessage(message);
      }
    }, new NewMessage({ incoming: true }));

  } catch (err) {
    console.error('Error in monitoring setup:', err);
    isMonitoring = false;
  }
}

// Sync history from target chat going back specified days (default 30)
export async function syncHistory(daysLimit = 30) {
  if (!client || connectionState !== 'connected') {
    throw new Error('Telegram client is not connected');
  }

  let targetChatId = getSetting('target_chat_id');
  if (!targetChatId) {
    const groupName = getSetting('target_chat_name', 'LBS Apartment Hunt');
    targetChatId = await findTargetChatId(groupName);
    if (targetChatId) {
      setSetting('target_chat_id', targetChatId);
    }
  }

  if (!targetChatId) {
    throw new Error('Target group chat "LBS Apartment Hunt" was not found in your Telegram dialogs.');
  }

  console.log(`Syncing messages from chat ID: ${targetChatId} going back ${daysLimit} days...`);

  const entity = await client.getInputEntity(targetChatId);
  const thirtyDaysAgo = Date.now() / 1000 - daysLimit * 24 * 60 * 60;
  
  let allMessages = [];
  let offsetId = 0;
  const batchSize = 100;
  let reachedLimit = false;
  const maxMessages = 2000; // safety cap to prevent API abuse

  while (!reachedLimit && allMessages.length < maxMessages) {
    console.log(`Fetching batch of ${batchSize} messages starting from offset ID: ${offsetId}...`);
    const batch = await client.getMessages(entity, {
      limit: batchSize,
      offsetId: offsetId
    });

    if (!batch || batch.length === 0) {
      break;
    }

    for (const msg of batch) {
      if (msg.date < thirtyDaysAgo) {
        reachedLimit = true;
        break;
      }
      allMessages.push(msg);
    }

    // Set offsetId for next batch to the oldest message in this batch
    offsetId = batch[batch.length - 1].id;

    // If batch size returned is less than requested, we reached the beginning of chat history
    if (batch.length < batchSize) {
      break;
    }
  }

  console.log(`Fetched total of ${allMessages.length} messages from the last ${daysLimit} days. Processing...`);

  // Process messages sequentially to prevent DB lock
  let processedCount = 0;
  for (const message of allMessages) {
    await processTelegramMessage(message);
    processedCount++;
  }

  console.log('History synchronization complete.');
  return { success: true, count: processedCount };
}
