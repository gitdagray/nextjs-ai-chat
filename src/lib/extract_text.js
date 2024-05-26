import fs from 'fs';
import pdf from 'pdf-parse';

const pdfPath = './public/tax-guide.pdf';

const extractText = async () => {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('Error reading or parsing PDF file:', error);
    throw error;
  }
};

extractText().then((text) => {
  fs.writeFileSync('extracted_text.txt', text);
}).catch((error) => {
  console.error('Error extracting text from PDF:', error);
});
