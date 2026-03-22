import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { searchCreators } from '../src/searchCreators';
import { pool } from '../src/db';
import type { BrandProfile } from '../src/types';

// ── Required brand profile for the submission ──────────────────────────────
const brand_smart_home: BrandProfile = {
  id: 'brand_smart_home',
  industries: ['Home', 'Tools & Hardware', 'Phones & Electronics'],
  target_audience: {
    gender: 'FEMALE',
    age_ranges: ['25-34', '35-44'],
  },
  gmv: 50000,
};

// ── Required query from the README ────────────────────────────────────────
const QUERY = 'Affordable home decor for small apartments';

async function run() {
  console.log(`\nQuery: "${QUERY}"`);
  console.log(`Brand: ${brand_smart_home.id}\n`);

  const results = await searchCreators(QUERY, brand_smart_home);

  // Print top 10 in a table
  console.log('Top 10 results:');
  console.table(
    results.slice(0, 10).map((r, i) => ({
      rank:      i + 1,
      username:  r.username,
      semantic:  r.scores.semantic_score,
      projected: r.scores.projected_score,
      final:     r.scores.final_score,
      gmv:       r.metrics.total_gmv_30d,
      tags:      r.content_style_tags.join(', '),
    }))
  );

  // Write the required output JSON (top 10)
  const outputPath = path.join(__dirname, '..', 'output_brand_smart_home.json');
  fs.writeFileSync(outputPath, JSON.stringify(results.slice(0, 10), null, 2));
  console.log(`\n✓ Written: output_brand_smart_home.json`);

  await pool.end();
}

run().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
