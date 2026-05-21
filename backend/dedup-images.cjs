const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function deduplicateImages() {
  console.log('Fetching properties...');
  const { data: properties, error } = await supabase.from('properties').select('*');
  
  if (error) {
    console.error('Error fetching:', error);
    return;
  }

  let updatedCount = 0;

  for (const prop of properties) {
    if (!prop.image_paths || prop.image_paths.length <= 1) continue;

    const uniqueMsgIds = new Set();
    const newPaths = [];

    for (const url of prop.image_paths) {
      // url looks like: https://.../media_60885_1779216170536.jpg
      const match = url.match(/media_(\d+)_/);
      if (match) {
        const msgId = match[1];
        if (!uniqueMsgIds.has(msgId)) {
          uniqueMsgIds.add(msgId);
          newPaths.push(url);
        }
      } else {
        newPaths.push(url);
      }
    }

    if (newPaths.length !== prop.image_paths.length) {
      console.log(`Property ${prop.id}: deduplicating ${prop.image_paths.length} images -> ${newPaths.length} images`);
      const { error: updateErr } = await supabase
        .from('properties')
        .update({ image_paths: newPaths })
        .eq('id', prop.id);
        
      if (updateErr) {
        console.error(`Failed to update ${prop.id}:`, updateErr);
      } else {
        updatedCount++;
      }
    }
  }

  console.log(`Finished deduplicating. Updated ${updatedCount} properties.`);
}

deduplicateImages();
