import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, 'listings.db');
const db = new Database(dbPath);

// Create tables if they do not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_message_id INTEGER UNIQUE,
    sender_name TEXT,
    sender_phone TEXT,
    price REAL,
    currency TEXT,
    location TEXT,
    latitude REAL,
    longitude REAL,
    description TEXT,
    date_posted TEXT,
    status TEXT DEFAULT 'available',
    image_paths TEXT, -- Comma-separated or JSON array of local paths
    tags TEXT,        -- JSON array of tags
    raw_message TEXT,
    price_type TEXT DEFAULT 'monthly'
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Add price_type column if it doesn't exist (migration for existing database)
try {
  db.exec("ALTER TABLE properties ADD COLUMN price_type TEXT DEFAULT 'monthly'");
} catch (e) {
  // Column already exists, ignore
}

// Helper to get a setting
export function getSetting(key, defaultValue = null) {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get(key);
  return row ? row.value : defaultValue;
}

// Helper to set a setting
export function setSetting(key, value) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  stmt.run(key, value.toString());
}

// Helper to get alert criteria
export function getAlertCriteria() {
  const criteriaJson = getSetting('alert_criteria');
  if (criteriaJson) {
    try {
      return JSON.parse(criteriaJson);
    } catch (e) {
      console.error('Failed to parse alert criteria JSON', e);
    }
  }
  return {
    maxPrice: 2000,
    preferredLocations: [],
    excludedKeywords: []
  };
}

// Get all properties matching criteria
export function getAllProperties() {
  const stmt = db.prepare('SELECT * FROM properties ORDER BY date_posted DESC');
  return stmt.all().map(prop => ({
    ...prop,
    tags: prop.tags ? JSON.parse(prop.tags) : [],
    image_paths: prop.image_paths ? JSON.parse(prop.image_paths) : []
  }));
}

// Save or Update a property
export function upsertProperty(propertyData) {
  const {
    original_message_id,
    sender_name,
    sender_phone,
    price,
    currency,
    location,
    latitude,
    longitude,
    description,
    date_posted,
    status,
    image_paths,
    tags,
    raw_message,
    price_type
  } = propertyData;

  let existing = null;
  
  // 1. Check if property exists by original_message_id
  existing = db.prepare('SELECT * FROM properties WHERE original_message_id = ?').get(original_message_id);

  // 2. If not found, try to match duplicate by same sender and location (if location is valid and sender is not Unknown)
  if (!existing && location) {
    let query = 'SELECT * FROM properties WHERE LOWER(TRIM(location)) = LOWER(TRIM(?))';
    let params = [location];
    
    const hasName = sender_name && sender_name.toLowerCase() !== 'unknown' && sender_name.trim() !== '';
    const hasPhone = sender_phone && sender_phone.trim() !== '';
    
    if (hasName || hasPhone) {
      if (hasName && hasPhone) {
        query += ' AND (LOWER(TRIM(sender_name)) = LOWER(TRIM(?)) OR sender_phone = ?)';
        params.push(sender_name, sender_phone);
      } else if (hasName) {
        query += ' AND LOWER(TRIM(sender_name)) = LOWER(TRIM(?))';
        params.push(sender_name);
      } else if (hasPhone) {
        query += ' AND sender_phone = ?';
        params.push(sender_phone);
      }
      
      existing = db.prepare(query + ' LIMIT 1').get(...params);
    }
  }

  const imagesJson = JSON.stringify(image_paths || []);
  const tagsJson = JSON.stringify(tags || []);

  if (existing) {
    // Update existing property (keep its current status unless explicitly updated)
    const newStatus = status || existing.status;
    
    // Combine images
    let combinedImages = image_paths || [];
    try {
      const existingImages = JSON.parse(existing.image_paths || '[]');
      combinedImages = [...new Set([...existingImages, ...combinedImages])];
    } catch (e) {
      console.error('Error combining images', e);
    }

    // Combine tags
    let combinedTags = tags || [];
    try {
      const existingTags = JSON.parse(existing.tags || '[]');
      combinedTags = [...new Set([...existingTags, ...combinedTags])];
    } catch (e) {
      console.error('Error combining tags', e);
    }

    // Ensure 'updated' tag is present if we are updating a duplicate listing from a different message
    if (existing.original_message_id !== original_message_id) {
      if (!combinedTags.includes('updated')) {
        combinedTags.push('updated');
      }
    }

    const stmt = db.prepare(`
      UPDATE properties SET
        original_message_id = ?,
        sender_name = ?,
        sender_phone = ?,
        price = ?,
        currency = ?,
        location = ?,
        latitude = ?,
        longitude = ?,
        description = ?,
        date_posted = ?,
        status = ?,
        image_paths = ?,
        tags = ?,
        raw_message = ?,
        price_type = ?
      WHERE id = ?
    `);
    
    stmt.run(
      original_message_id,
      sender_name || existing.sender_name,
      sender_phone || existing.sender_phone,
      price !== undefined && price !== null ? price : existing.price,
      currency || existing.currency,
      location || existing.location,
      latitude !== undefined && latitude !== null ? latitude : existing.latitude,
      longitude !== undefined && longitude !== null ? longitude : existing.longitude,
      description || existing.description,
      date_posted || existing.date_posted, // Brings to top!
      newStatus,
      JSON.stringify(combinedImages),
      JSON.stringify(combinedTags),
      raw_message || existing.raw_message,
      price_type || existing.price_type || 'monthly',
      existing.id
    );
    
    return { id: existing.id, isNew: false };
  } else {
    // Insert new property
    const stmt = db.prepare(`
      INSERT INTO properties (
        original_message_id,
        sender_name,
        sender_phone,
        price,
        currency,
        location,
        latitude,
        longitude,
        description,
        date_posted,
        status,
        image_paths,
        tags,
        raw_message,
        price_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      original_message_id,
      sender_name,
      sender_phone,
      price,
      currency,
      location,
      latitude,
      longitude,
      description,
      date_posted,
      status || 'available',
      imagesJson,
      tagsJson,
      raw_message,
      price_type || 'monthly'
    );
    
    return { id: result.lastInsertRowid, isNew: true };
  }
}

// Update status of a property
export function updatePropertyStatus(id, status) {
  const stmt = db.prepare('UPDATE properties SET status = ? WHERE id = ?');
  return stmt.run(status, id).changes > 0;
}

export default db;
