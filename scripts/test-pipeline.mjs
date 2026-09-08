import fs from 'fs';
import path from 'path';
import { pipeline, env } from '@xenova/transformers';
import pdfParse from 'pdf-parse';

env.useBrowserCache = false;
env.allowLocalModels = false;

async function testPipeline() {
  console.log('Testing Xenova/all-MiniLM-L6-v2 pipeline...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const sample = 'Cricket batting requires balance, head still, and playing under the eyes.';
  const output = await extractor(sample, { pooling: 'mean', normalize: true });
  const embedding = Array.from(output.data);
  console.log('Generated embedding length:', embedding.length);
  console.log('First 5 dimensions:', embedding.slice(0, 5));

  console.log('Testing pdf-parse on a sample file in data/...');
  const samplePdf = 'data/Habib_Noorbhai_and_Tim_Noakes_2018_An_ev.pdf';
  if (fs.existsSync(samplePdf)) {
    const buffer = fs.readFileSync(samplePdf);
    const pdfData = await pdfParse(buffer);
    console.log('PDF pages:', pdfData.numpages);
    console.log('Extracted text preview:', pdfData.text.slice(0, 200).replace(/\n+/g, ' '));
  } else {
    console.log('Sample PDF not found at', samplePdf);
  }
}

testPipeline().catch(console.error);
