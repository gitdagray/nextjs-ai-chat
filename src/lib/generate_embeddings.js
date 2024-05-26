import fs from 'fs';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    });

const generateEmbeddings = async (textChunks) => {
  const embeddings = [];
  for (const chunk of textChunks) {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small', 
      input: chunk,
    });
    embeddings.push(response.data[0].embedding);
    console.log('Embedding generated:', embeddings.length, '/', textChunks.length)
  }
  return embeddings;
};

const textChunks = JSON.parse(fs.readFileSync('text_chunks.json', 'utf-8'));
generateEmbeddings(textChunks).then((embeddings) => {
  fs.writeFileSync('embeddings.json', JSON.stringify(embeddings, null, 2));
});
