import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { supabase, getSetting, setSetting } from './supabase.js';
import { parsePropertyMessage } from './gemini.js';

async function downloadMessageMediaToSupabase(client, message) {
  if (!message.media) return null;

  // Only attempt to download photos/images to avoid Vercel OOM or Timeout on large videos
  let isImage = false;
  if (message.photo) isImage = true;
  else if (message.document && message.document.mimeType && message.document.mimeType.startsWith('image/')) {
    isImage = true;
  }
  
  if (!isImage) {
    console.log(`Skipping non-image media for message ${message.id}`);
    return null;
  }

  try {
    const buffer = await client.downloadMedia(message);
    if (!buffer) return null;

    let ext = 'jpg';
    if (message.media.document) {
      const mime = message.media.document.mimeType;
      if (mime) {
        const parts = mime.split('/');
        if (parts.length > 1) ext = parts[1];
      }
    }

    const fileName = `media_${message.id}_${Date.now()}.${ext}`;
    
    // Upload to Supabase Storage
    const { error } = await supabase.storage.from('property-images').upload(fileName, buffer, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      upsert: true
    });

    if (error) {
      console.error('Error uploading media to Supabase:', error);
      return null;
    }

    const { data: urlData } = supabase.storage.from('property-images').getPublicUrl(fileName);
    return urlData.publicUrl;
  } catch (err) {
    console.error('Error downloading/uploading message media:', err);
    return null;
  }
}

export async function processTelegramMessage(client, message) {
  try {
    if (!message.text || message.text.trim() === '') return;

    let senderName = 'Unknown';
    let senderPhone = '';
    
    try {
      const sender = await message.getSender();
      if (sender) {
        senderName = sender.firstName || sender.username || 'Unknown';
        if (sender.lastName) senderName += ' ' + sender.lastName;
        senderPhone = sender.phone || '';
      }
    } catch (e) {}

    const imagePaths = [];
    if (message.media) {
      const imgPath = await downloadMessageMediaToSupabase(client, message);
      if (imgPath) imagePaths.push(imgPath);
    }

    if (message.groupedId) {
      try {
        const targetChatId = await getSetting('target_chat_id');
        if (targetChatId) {
          const entity = await client.getInputEntity(targetChatId);
          const surrounding = await client.getMessages(entity, { limit: 15, offsetId: message.id + 5 });
          
          for (const otherMsg of surrounding) {
            if (otherMsg.id !== message.id && 
                otherMsg.groupedId && 
                otherMsg.groupedId.toString() === message.groupedId.toString() &&
                otherMsg.media) {
              const imgPath = await downloadMessageMediaToSupabase(client, otherMsg);
              if (imgPath) imagePaths.push(imgPath);
            }
          }
        }
      } catch (e) {
        console.error('Error fetching album messages:', e);
      }
    }

    const parsed = await parsePropertyMessage(message.text);

    if (parsed.is_property_listing) {
      // Upsert directly to Supabase
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
        image_paths: imagePaths, // This is a jsonb array of absolute URLs now
        tags: parsed.tags || [],
        raw_message: message.text,
        price_type: parsed.price_type || 'monthly'
      };

      // Check for duplicate to update
      let existing = null;
      const { data: existingById } = await supabase.from('properties').select('*').eq('original_message_id', message.id).single();
      existing = existingById;

      if (!existing && parsed.location) {
        // Try match by location + sender
        let query = supabase.from('properties').select('*').ilike('location', parsed.location.trim());
        const hasName = senderName && senderName.toLowerCase() !== 'unknown' && senderName.trim() !== '';
        const hasPhone = senderPhone && senderPhone.trim() !== '';
        
        if (hasName || hasPhone) {
          if (hasName && hasPhone) {
            query = query.or(`sender_name.ilike.${senderName.trim()},sender_phone.eq.${senderPhone}`);
          } else if (hasName) {
            query = query.ilike('sender_name', senderName.trim());
          } else {
            query = query.eq('sender_phone', senderPhone);
          }
          const { data: match } = await query.limit(1).maybeSingle();
          if (match) existing = match;
        }
      }

      if (existing) {
        let combinedImages = propertyData.image_paths || [];
        try {
          const existingImages = existing.image_paths || [];
          combinedImages = [...new Set([...existingImages, ...combinedImages])];
        } catch(e) {}

        let combinedTags = propertyData.tags || [];
        try {
          const existingTags = existing.tags || [];
          combinedTags = [...new Set([...existingTags, ...combinedTags])];
        } catch(e) {}

        if (existing.original_message_id !== message.id && !combinedTags.includes('updated')) {
          combinedTags.push('updated');
        }

        await supabase.from('properties').update({
          original_message_id: message.id,
          price: propertyData.price !== null ? propertyData.price : existing.price,
          description: propertyData.description || existing.description,
          date_posted: propertyData.date_posted, // Bring to top
          image_paths: combinedImages,
          tags: combinedTags,
          raw_message: propertyData.raw_message || existing.raw_message
        }).eq('id', existing.id);
      } else {
        await supabase.from('properties').insert(propertyData);
      }
    }
  } catch (err) {
    console.error(`Failed to process message ${message.id}:`, err);
  }
}

export async function syncHistoryStateless() {
  const sessionStr = await getSetting('telegram_session');
  if (!sessionStr) {
    console.error('No telegram session found. Sync aborted.');
    return { success: false, error: 'No session', errorCode: 'ERR_NO_SESSION' };
  }

  const apiIdStr = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiIdStr || !apiHash) {
    return { success: false, error: 'Missing Telegram API credentials', errorCode: 'ERR_MISSING_CREDS' };
  }

  const client = new TelegramClient(new StringSession(sessionStr), parseInt(apiIdStr), apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
    console.log('Telegram client connected statelessly.');

    let targetChatId = await getSetting('target_chat_id');
    if (!targetChatId) {
      // Try to find it
      const groupName = await getSetting('target_chat_name') || 'LBS Apartment Hunt';
      const dialogs = await client.getDialogs();
      for (const d of dialogs) {
        if (d.name === groupName) {
          targetChatId = d.entity.id.toString();
          await setSetting('target_chat_id', targetChatId);
          break;
        }
      }
    }

    if (!targetChatId) {
      const err = new Error('Target group chat not found.');
      err.code = 'ERR_CHAT_NOT_FOUND';
      throw err;
    }

    const entity = await client.getInputEntity(targetChatId);
    const thirtyDaysAgo = Date.now() / 1000 - 30 * 24 * 60 * 60;
    
    const lastSyncIdStr = await getSetting('last_synced_msg_id');
    const lastSyncId = lastSyncIdStr ? parseInt(lastSyncIdStr, 10) : 0;
    
    let allMessages = [];
    let offsetId = 0;
    let reachedLimit = false;

    // Fetch up to 100 recent messages to find new ones
    while (!reachedLimit && allMessages.length < 100) {
      const batch = await client.getMessages(entity, { limit: 50, offsetId });
      if (!batch || batch.length === 0) break;

      for (const msg of batch) {
        if (msg.date < thirtyDaysAgo || (lastSyncId > 0 && msg.id <= lastSyncId)) {
          reachedLimit = true;
          break;
        }
        allMessages.push(msg);
      }
      offsetId = batch[batch.length - 1].id;
      if (batch.length < 50) break;
    }

    // Sort ascending to process oldest first
    allMessages.sort((a, b) => a.id - b.id);

    console.log(`Stateless Sync: Fetched ${allMessages.length} new messages. Processing...`);

    let processedCount = 0;
    let highestProcessedId = lastSyncId;
    
    // Limit to 5 to stay well within Vercel's 10s Serverless timeout
    const batchToProcess = allMessages.slice(0, 5);

    for (const message of batchToProcess) {
      await processTelegramMessage(client, message);
      if (message.id > highestProcessedId) {
        highestProcessedId = message.id;
      }
      processedCount++;
    }

    if (highestProcessedId > lastSyncId) {
      await setSetting('last_synced_msg_id', highestProcessedId.toString());
    }

    await client.disconnect();
    return { success: true, count: processedCount, pending: allMessages.length - processedCount };

  } catch (e) {
    console.error('Error during stateless sync:', e);
    try { await client.disconnect(); } catch (err) {}
    
    let errorCode = e.code || 'ERR_UNKNOWN';
    if (e.message && e.message.includes('FloodWait')) errorCode = 'ERR_RATE_LIMIT';
    else if (e.message && e.message.includes('TIMEOUT')) errorCode = 'ERR_TIMEOUT';
    else if (e.message && e.message.includes('session')) errorCode = 'ERR_SESSION_INVALID';
    
    return { success: false, error: e.message, errorCode };
  }
}
