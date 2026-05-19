import { parsePropertyMessage } from './gemini.js';
import dotenv from 'dotenv';

dotenv.config();

const sampleMessages = [
  `Double room available in Clapham Common! Rent is £950pcm bills excluded. Close to the tube station, has a nice garden. Looking for a young professional to join our friendly houseshare. PM if interested!`,
  `Hey guys, has anyone seen my keys? Left them near the kitchen yesterday.`,
  `Room available in Angel! £1200 pcm bills included, double bed, en-suite. Room is filled now though, thanks everyone!`,
  `Flat share in South Kensington - 2 bed flat, £1500 per month, student friendly. Let me know if you want photos.`
];

async function runTest() {
  console.log('--- Starting Parser Tests ---\n');
  
  for (let i = 0; i < sampleMessages.length; i++) {
    const msg = sampleMessages[i];
    console.log(`[Test ${i+1}] Message: "${msg.substring(0, 80)}..."`);
    console.log('Parsing...');
    
    const startTime = Date.now();
    const result = await parsePropertyMessage(msg);
    const duration = Date.now() - startTime;
    
    console.log(`Parsed in ${duration}ms:`);
    console.log(JSON.stringify(result, null, 2));
    console.log('-------------------------------------\n');
  }
}

runTest();
