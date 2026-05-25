import { GoogleGenAI } from '@google/genai';

let ai = null;

// Initialize GoogleGenAI client if API Key is available
const apiKey = process.env.GEMINI_API_KEY;
if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
} else {
  console.warn('GEMINI_API_KEY is not defined in the environment variables. LLM parsing will be disabled.');
}

/**
 * Uses Gemini API to parse listing details from Telegram message text.
 * Falls back to basic regex parsing if Gemini is not available.
 * 
 * @param {string} text Raw Telegram message text
 * @returns {Promise<Object>} Structured property object
 */
export async function parsePropertyMessage(text) {
  if (!ai) {
    return fallbackRegexParse(text);
  }

  const prompt = `
    Analyze this message from a London student/young professional housing hunt Telegram group chat.
    Extract the property details. If it is NOT a property listing (e.g., just someone saying hello, asking a general question, or chatting), set "is_property_listing" to false.
    
    If it is a property listing:
    1. Extract the price as a number. If there is a price range, extract the average or the main price.
    2. Extract the currency (usually "GBP").
    3. Extract the location (e.g., "Clapham Junction", "South Kensington", "Bayswater"). Keep it concise.
    4. Provide the approximate latitude and longitude coordinates for this neighborhood in London. Use your general knowledge of London geography to approximate these coordinates (e.g. Clapham is approx 51.4624, -0.1370; South Kensington is 51.4941, -0.1759). This is crucial for showing a marker on our local Leaflet map.
    5. Summarize the description (number of rooms, housemates, amenities).
    6. Extract tags (e.g., "double room", "garden", "ensuite", "bills included").
    7. Check if the message implies that the property has been TAKEN or SNAPPED UP or is NO LONGER AVAILABLE. Set "status" to "snapped_up" if so, otherwise "available".

    Message to analyze:
    """
    ${text}
    """
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            is_property_listing: { 
              type: 'BOOLEAN', 
              description: 'Whether this message is listing a room, flat, or apartment for rent.' 
            },
            price: { 
              type: 'NUMBER', 
              description: 'The rental price (per month or per week). Normalize to monthly if possible, otherwise keep as is.' 
            },
            currency: { 
              type: 'STRING', 
              description: 'The currency code (e.g., GBP, EUR, USD).' 
            },
            location: { 
              type: 'STRING', 
              description: 'Concise neighborhood or station name in London (e.g., Clapham, Camden, Angel).' 
            },
            latitude: { 
              type: 'NUMBER', 
              description: 'Approximate latitude of the location in London.' 
            },
            longitude: { 
              type: 'NUMBER', 
              description: 'Approximate longitude of the location in London.' 
            },
            description: { 
              type: 'STRING', 
              description: 'A brief 1-2 sentence summary of the key features of the listing.' 
            },
            tags: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Useful descriptive tags (e.g., single room, double room, ensuite, student-friendly).'
            },
            status: {
              type: 'STRING',
              enum: ['available', 'snapped_up'],
              description: 'Status of the listing based on the message. If the message says "Taken", "Room filled", or similar, set to snapped_up, else available.'
            },
            price_type: {
              type: 'STRING',
              enum: ['monthly', 'nightly', 'weekly'],
              description: 'Whether the price is listed on a monthly, nightly, or weekly basis. E.g. "pcm", "per month" -> monthly; "per night", "pn", "/night" -> nightly; "pw", "per week" -> weekly. Defaults to monthly.'
            }
          },
          required: ['is_property_listing']
        }
      }
    });

    const resultText = response.text;
    const parsedData = JSON.parse(resultText);

    if (parsedData.is_property_listing) {
      let finalPrice = parsedData.price || null;
      if (finalPrice !== null && finalPrice <= 0) {
        finalPrice = null;
      }
      return {
        is_property_listing: true,
        price: finalPrice,
        currency: parsedData.currency || 'GBP',
        location: parsedData.location || 'London',
        latitude: parsedData.latitude || 51.5074, // Default London lat
        longitude: parsedData.longitude || -0.1278, // Default London lon
        description: parsedData.description || text.substring(0, 150) + '...',
        tags: parsedData.tags || [],
        status: parsedData.status || 'available',
        price_type: parsedData.price_type || 'monthly'
      };
    } else {
      return { is_property_listing: false };
    }
  } catch (error) {
    console.error('Error during Gemini parsing:', error);
    return fallbackRegexParse(text);
  }
}

/**
 * A basic regex parser fallback when Gemini is unavailable.
 */
function fallbackRegexParse(text) {
  const cleanText = text.toLowerCase();
  
  // Exclude basic conversational texts
  const conversationalKeywords = ['hello', 'hi everyone', 'does anyone', 'looking for', 'search of'];
  const hasListingKeywords = ['available', 'rent', 'pcm', 'pw', 'room', 'flat', 'studio', 'house', 'tenancy'];
  
  const isConversational = conversationalKeywords.some(kw => cleanText.includes(kw)) && !cleanText.includes('available');
  const isListing = hasListingKeywords.some(kw => cleanText.includes(kw));

  if (isConversational || !isListing) {
    return { is_property_listing: false };
  }

  // Try to parse price: looking for £ or £ symbol and numbers
  let price = null;
  const priceRegex = /(?:£|\$|€)\s*(\d+(?:[.,]\d+)?)/;
  const match = text.match(priceRegex);
  if (match) {
    price = parseFloat(match[1].replace(',', ''));
  }

  // Try to parse basic location
  let location = 'London';
  const locationMatches = [
    'clapham', 'camden', 'angel', 'islington', 'bayswater', 'kensington', 
    'chelsea', 'fulham', 'shoreditch', 'hackney', 'brixton', 'greenwich', 
    'wimbledon', 'stratford', 'paddington', 'earls court', 'hammersmith'
  ];
  for (const loc of locationMatches) {
    if (cleanText.includes(loc)) {
      location = loc.charAt(0).toUpperCase() + loc.slice(1);
      break;
    }
  }

  // Set default coordinates based on location
  const coords = {
    'Clapham': { lat: 51.4624, lon: -0.1370 },
    'Camden': { lat: 51.5390, lon: -0.1426 },
    'Angel': { lat: 51.5325, lon: -0.1058 },
    'Islington': { lat: 51.5416, lon: -0.1022 },
    'Bayswater': { lat: 51.5113, lon: -0.1873 },
    'Kensington': { lat: 51.5014, lon: -0.1906 },
    'Chelsea': { lat: 51.4875, lon: -0.1687 },
    'Fulham': { lat: 51.4801, lon: -0.2108 },
    'Shoreditch': { lat: 51.5262, lon: -0.0782 },
    'Hackney': { lat: 51.5450, lon: -0.0553 },
    'Brixton': { lat: 51.4613, lon: -0.1156 },
    'Greenwich': { lat: 51.4826, lon: -0.0077 }
  };

  const matchedCoords = coords[location] || { lat: 51.5074, lon: -0.1278 };

  // Status check
  const status = (cleanText.includes('taken') || cleanText.includes('filled') || cleanText.includes('no longer available'))
    ? 'snapped_up'
    : 'available';

  // Price type check
  let price_type = 'monthly';
  if (cleanText.includes('per night') || cleanText.includes('pn') || cleanText.includes('/night')) {
    price_type = 'nightly';
  } else if (cleanText.includes('per week') || cleanText.includes('pw') || cleanText.includes('/week')) {
    price_type = 'weekly';
  }

  let finalPrice = price;
  if (finalPrice !== null && finalPrice <= 0) {
    finalPrice = null;
  }

  return {
    is_property_listing: true,
    price: finalPrice,
    currency: 'GBP',
    location,
    latitude: matchedCoords.lat,
    longitude: matchedCoords.lon,
    description: text.length > 150 ? text.substring(0, 150) + '...' : text,
    tags: [location.toLowerCase(), 'rental'],
    status,
    price_type
  };
}
