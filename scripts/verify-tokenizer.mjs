import { pipeline, AutoTokenizer, env } from '@xenova/transformers';

env.useBrowserCache = false;
env.allowLocalModels = false;

async function checkTokenizer() {
    console.log('🔍 Testing Xenova/all-MiniLM-L6-v2 tokenizer & pipeline...');
    const tokenizer = await AutoTokenizer.from_pretrained('Xenova/all-MiniLM-L6-v2');
    console.log('Tokenizer max_model_len / model_max_length:', tokenizer.model_max_length);

    const testText = 'cricket coaching '.repeat(200); // ~400 tokens
    const tokens = tokenizer(testText);
    console.log('Encoded tokens length:', tokens.input_ids.data.length);

    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    const output = await extractor(testText, { pooling: 'mean', normalize: true });
    console.log('Embedding output shape / dimensions:', output.data.length);
}

checkTokenizer().catch(console.error);
