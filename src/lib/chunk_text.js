import fs from 'fs';

const CHUNK_SIZE = 1000; // Adjust the chunk size as needed

const chunkText = (text) => {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.substring(i, i + CHUNK_SIZE));
  }
  return chunks;
};

const text = fs.readFileSync('extracted_text.txt', 'utf-8');
const chunks = chunkText(text);
fs.writeFileSync('text_chunks.json', JSON.stringify(chunks, null, 2));
