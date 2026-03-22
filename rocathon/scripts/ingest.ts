import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { pool } from '../src/db';
import { embed, creatorEmbedText } from '../src/embed';
import type { Creator } from '../src/types';

// Detect embedding dimension based on provider
// const PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'openai';
const PROVIDER = 'local';
const VECTOR_DIM = PROVIDER === 'local' ? 384 : 1536;

async function ingest() {
  const creatorsPath = path.join(__dirname, '..', 'creators.json');
  const creators: Creator[] = JSON.parse(fs.readFileSync(creatorsPath, 'utf-8'));

  const client = await pool.connect();
  try {
    // Setup
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await client.query(`DROP TABLE IF EXISTS creators`);
    await client.query(`
      CREATE TABLE creators (
        id              SERIAL PRIMARY KEY,
        username        TEXT UNIQUE NOT NULL,
        bio             TEXT,
        content_style_tags TEXT[],
        projected_score FLOAT,
        metrics         JSONB,
        embedding       VECTOR(${VECTOR_DIM})
      )
    `);

    // HNSW index — satisfies the "no linear scan" hard constraint
    await client.query(`
      CREATE INDEX creators_hnsw_idx
      ON creators
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);

    console.log(`Ingesting ${creators.length} creators (provider: ${PROVIDER}, dims: ${VECTOR_DIM})...`);

    for (let i = 0; i < creators.length; i++) {
      const c = creators[i];
      const text = creatorEmbedText(c.bio, c.content_style_tags);
      const embedding = await embed(text);

      await client.query(
        `INSERT INTO creators
           (username, bio, content_style_tags, projected_score, metrics, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (username) DO UPDATE
           SET embedding = EXCLUDED.embedding`,
        [
          c.username,
          c.bio,
          c.content_style_tags,
          c.projected_score,
          JSON.stringify(c.metrics),
          JSON.stringify(embedding),
        ]
      );

      process.stdout.write(`\r${i + 1}/${creators.length} ingested`);
    }

    console.log('\n✓ Ingest complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

ingest().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
