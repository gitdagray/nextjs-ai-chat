import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PRIVATE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const storeEmbeddings = async (textChunks, embeddings) => {
  for (let i = 0; i < textChunks.length; i++) {
    const { data, error } = await supabase
      .from('documents')
      .insert([
        {
          page_content: textChunks[i],
          embedding: embeddings[i],
          metadata: { source: 'tax-guide.pdf', chunk_index: i },
        },
      ]);
    if (error) {
      console.error('Error inserting document:', error);
    } else {
      console.log('Document inserted:', data);
    }
  }
};

const textChunks = JSON.parse(fs.readFileSync('text_chunks.json', 'utf-8'));
const embeddings = JSON.parse(fs.readFileSync('embeddings.json', 'utf-8'));
storeEmbeddings(textChunks, embeddings);
