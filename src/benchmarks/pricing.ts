export interface ModelPricing {
  model_family: string;
  input_usd_per_mtok: number;
  cache_write_usd_per_mtok: number;
  cache_read_usd_per_mtok: number;
  output_usd_per_mtok: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

export interface CostBreakdown {
  model_family: string;
  input_cost_usd: number;
  cache_write_cost_usd: number;
  cache_read_cost_usd: number;
  output_cost_usd: number;
  total_cost_usd: number;
}

const TOKENS_PER_MILLION = 1_000_000;

export const SONNET_4_5_PRICING: ModelPricing = {
  model_family: "claude-sonnet-4-5",
  input_usd_per_mtok: 3.0,
  cache_write_usd_per_mtok: 3.75,
  cache_read_usd_per_mtok: 0.3,
  output_usd_per_mtok: 15.0,
};

export function getPricingForModel(model: string): ModelPricing {
  const normalized = model.toLowerCase();
  if (normalized.includes("sonnet-4-5")) {
    return SONNET_4_5_PRICING;
  }

  throw new Error(
    `No pricing configured for model "${model}". Add a pricing entry before running cost analysis.`,
  );
}

export function calculateCostFromUsage(
  usage: TokenUsage,
  pricing: ModelPricing,
): CostBreakdown {
  const input_cost_usd =
    (usage.input_tokens * pricing.input_usd_per_mtok) / TOKENS_PER_MILLION;
  const cache_write_cost_usd =
    (usage.cache_creation_tokens * pricing.cache_write_usd_per_mtok) /
    TOKENS_PER_MILLION;
  const cache_read_cost_usd =
    (usage.cache_read_tokens * pricing.cache_read_usd_per_mtok) /
    TOKENS_PER_MILLION;
  const output_cost_usd =
    (usage.output_tokens * pricing.output_usd_per_mtok) / TOKENS_PER_MILLION;

  const total_cost_usd =
    input_cost_usd +
    cache_write_cost_usd +
    cache_read_cost_usd +
    output_cost_usd;

  return {
    model_family: pricing.model_family,
    input_cost_usd,
    cache_write_cost_usd,
    cache_read_cost_usd,
    output_cost_usd,
    total_cost_usd,
  };
}
