import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials in environment variables.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function getSetting(key, defaultValue = null) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).single();
  if (error || !data) return defaultValue;
  return data.value;
}

export async function setSetting(key, value) {
  await supabase.from('settings').upsert({ key, value: value.toString() });
}

export async function getAlertCriteria() {
  const criteriaJson = await getSetting('alert_criteria');
  if (criteriaJson) {
    try {
      return JSON.parse(criteriaJson);
    } catch (e) {
      console.error('Failed to parse alert_criteria setting', e);
    }
  }
  return {
    maxPrice: 2000,
    preferredLocations: [],
    excludedKeywords: []
  };
}

export async function getAllProperties() {
  const { data, error } = await supabase.from('properties').select('*').order('date_posted', { ascending: false });
  if (error) {
    console.error('Error fetching properties', error);
    return [];
  }
  return data;
}

export async function updatePropertyStatus(id, status) {
  const { error } = await supabase.from('properties').update({ status }).eq('id', id);
  return !error;
}
