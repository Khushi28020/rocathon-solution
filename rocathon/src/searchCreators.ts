import * as dotenv from 'dotenv';
dotenv.config();

import type { BrandProfile, RankedCreator } from './types';
import { pool } from './db';
import { embed } from './embed';

// ─── Weights ──────────────────────────────────────────────────────────────────
// Recommended starting weights from the challenge spec.
// Projected (commerce) slightly outweighs semantic (vibe) — by design.
const SEMANTIC_WEIGHT  = 0.45;
const PROJECTED_WEIGHT = 0.55;

// ─── Hard rules ───────────────────────────────────────────────────────────────
// Challenge rule: "high vibe / zero GMV must rank lower than good vibe / high GMV"
const ZERO_GMV_PENALTY = 0.60;

// Soft penalties — creator is still surfaced, just pushed down
const GENDER_MISMATCH_PENALTY   = 0.85;
const INDUSTRY_MISMATCH_PENALTY = 0.90;

/**
 * Search and rank creators for a given natural-language query and brand profile.
 *
 * Pipeline:
 *  1. Embed query → vector
 *  2. pgvector HNSW cosine search → top 50 candidates
 *  3. Hybrid re-ranking: (semantic × 0.45) + (projected_norm × 0.55)
 *  4. Apply brand profile multipliers (GMV rule, gender, industry)
 *  5. Sort descending, return RankedCreator[]
 */
export async function searchCreators(
  query: string,
  brandProfile: BrandProfile
): Promise<RankedCreator[]> {

  // ── 1. Embed the query ──────────────────────────────────────────────────────
  const queryVector = await embed(query);

  // ── 2. Vector retrieval — top 50 by cosine similarity ──────────────────────
  // pgvector: <=> = cosine DISTANCE, so similarity = 1 - distance
  const { rows } = await pool.query(
    `SELECT
       username,
       bio,
       content_style_tags,
       projected_score,
       metrics,
       1 - (embedding <=> $1::vector) AS semantic_score
     FROM creators
     ORDER BY embedding <=> $1::vector
     LIMIT 50`,
    [JSON.stringify(queryVector)]
  );

  // ── 3 & 4. Hybrid scoring + brand profile adjustments ──────────────────────
  const results: RankedCreator[] = rows.map((row: any) => {
    const m = row.metrics;

    // Normalise projected_score 60–100 → 0–1 (same scale as cosine similarity)
    const projectedNorm = (row.projected_score - 60) / 40;

    // Base hybrid score
    let finalScore =
      SEMANTIC_WEIGHT  * row.semantic_score +
      PROJECTED_WEIGHT * projectedNorm;

    // Hard rule: zero GMV penalty
    if (m.total_gmv_30d === 0) {
      finalScore *= ZERO_GMV_PENALTY;
    }

    // Soft: industry alignment — reward overlap with brand's industries
    if (brandProfile.industries?.length > 0) {
      const hasOverlap = row.content_style_tags.some((tag: string) =>
        brandProfile.industries.includes(tag as any)
      );
      if (!hasOverlap) finalScore *= INDUSTRY_MISMATCH_PENALTY;
    }

    // Soft: audience gender alignment
    // gender_pct is stored as integer (e.g. 8200 = 82%)
    if (brandProfile.target_audience?.gender) {
      const audienceGender = m.demographics?.major_gender;
      if (audienceGender && audienceGender !== brandProfile.target_audience.gender) {
        finalScore *= GENDER_MISMATCH_PENALTY;
      }
    }

    return {
      username: row.username,
      bio: row.bio,
      content_style_tags: row.content_style_tags,
      projected_score: row.projected_score,
      metrics: m,
      scores: {
        semantic_score:  Math.round(row.semantic_score * 10000) / 10000,
        projected_score: row.projected_score,
        final_score:     Math.round(finalScore * 10000) / 10000,
      },
    };
  });

  // ── 5. Sort descending by final_score ──────────────────────────────────────
  results.sort((a, b) => b.scores.final_score - a.scores.final_score);

  return results;
}
