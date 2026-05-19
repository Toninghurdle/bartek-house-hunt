import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../.env');
const DB_PATH = path.resolve(__dirname, 'listings.db');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');

async function main() {
  // 1. Read .env
  const envContent = await fs.readFile(ENV_PATH, 'utf-8');
  const envVars = {};
  envContent.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length > 0) {
      envVars[key.trim()] = rest.join('=').trim();
    }
  });

  const SUPABASE_URL = envVars.SUPABASE_URL;
  const SUPABASE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const db = new Database(DB_PATH);

  // 2. Migrate Settings
  console.log('Migrating settings...');
  const settings = db.prepare('SELECT * FROM settings').all();
  for (const row of settings) {
    const { error } = await supabase.from('settings').upsert({ key: row.key, value: row.value });
    if (error) console.error(`Error migrating setting ${row.key}:`, error);
  }
  console.log(`Migrated ${settings.length} settings.`);

  // 3. Migrate Properties & Images
  console.log('Migrating properties and uploading images...');
  const properties = db.prepare('SELECT * FROM properties').all();
  
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i];
    let newImagePaths = [];
    try {
      const localPaths = JSON.parse(prop.image_paths || '[]');
      
      for (const localPath of localPaths) {
        // Skip if already a full URL
        if (localPath.startsWith('http')) {
          newImagePaths.push(localPath);
          continue;
        }

        const fileName = localPath.split('/').pop();
        const absoluteLocalPath = path.join(UPLOADS_DIR, fileName);
        
        try {
          const fileBuffer = await fs.readFile(absoluteLocalPath);
          const { data, error } = await supabase.storage.from('property-images').upload(fileName, fileBuffer, {
            upsert: true,
            contentType: 'image/jpeg'
          });
          
          if (error) {
            console.error(`Error uploading image ${fileName}:`, error.message);
          } else {
            const { data: urlData } = supabase.storage.from('property-images').getPublicUrl(fileName);
            newImagePaths.push(urlData.publicUrl);
          }
        } catch (fileErr) {
          console.error(`Local file not found for ${fileName}`);
        }
      }
    } catch (e) {
      console.error(`Error parsing image paths for property ${prop.id}`, e);
    }
    
    const { error: propErr } = await supabase.from('properties').upsert({
      id: prop.id, 
      original_message_id: prop.original_message_id,
      sender_name: prop.sender_name,
      sender_phone: prop.sender_phone,
      price: prop.price,
      currency: prop.currency,
      location: prop.location,
      latitude: prop.latitude,
      longitude: prop.longitude,
      description: prop.description,
      date_posted: prop.date_posted,
      status: prop.status,
      image_paths: newImagePaths,
      tags: JSON.parse(prop.tags || '[]'),
      raw_message: prop.raw_message,
      price_type: prop.price_type
    });
    
    if (propErr) {
      console.error(`Error migrating property ${prop.id}:`, propErr.message);
    }
    if ((i + 1) % 10 === 0) {
      console.log(`Processed ${i + 1} / ${properties.length} properties...`);
    }
  }
  
  console.log(`Migrated ${properties.length} properties.`);
  console.log('Migration complete.');
}

main().catch(console.error);
