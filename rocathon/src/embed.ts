import * as dotenv from 'dotenv';
dotenv.config();

// const PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'openai';
const PROVIDER = 'local';

let _pipeline: any = null;

async function getLocalPipeline() {
  if (!_pipeline) {
    // @ts-ignore — optional dep
    const { pipeline } = await import('@xenova/transformers');
    _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return _pipeline;
}

export async function embed(text: string): Promise<number[]> {
  if (PROVIDER === 'local') {
    const pipe = await getLocalPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data) as number[];
  }

  // Default: OpenAI text-embedding-3-small (1536 dims)
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

/**
 * Build the text surface we embed for each creator.
 * Combining bio + tags gives richer semantic coverage than bio alone.
 */
export function creatorEmbedText(bio: string, tags: string[]): string {
  return `${bio}. Content categories: ${tags.join(', ')}`;
}
