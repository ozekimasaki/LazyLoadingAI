import { describe, expect, it } from "vitest";
import {
  SONNET_4_5_PRICING,
  calculateCostFromUsage,
  getPricingForModel,
} from "../../../src/benchmarks/pricing.js";

describe("pricing helpers", () => {
  it("resolves sonnet 4.5 pricing for dated model ids", () => {
    const pricing = getPricingForModel("claude-sonnet-4-5-20250929");
    expect(pricing).toEqual(SONNET_4_5_PRICING);
  });

  it("calculates category-based cost correctly", () => {
    const breakdown = calculateCostFromUsage(
      {
        input_tokens: 1_000,
        output_tokens: 200,
        cache_read_tokens: 5_000,
        cache_creation_tokens: 3_000,
      },
      SONNET_4_5_PRICING,
    );

    expect(breakdown.input_cost_usd).toBeCloseTo(0.003, 8);
    expect(breakdown.output_cost_usd).toBeCloseTo(0.003, 8);
    expect(breakdown.cache_read_cost_usd).toBeCloseTo(0.0015, 8);
    expect(breakdown.cache_write_cost_usd).toBeCloseTo(0.01125, 8);
    expect(breakdown.total_cost_usd).toBeCloseTo(0.01875, 8);
  });

  it("throws when pricing is missing for a model", () => {
    expect(() => getPricingForModel("claude-opus-unknown")).toThrow(
      /No pricing configured/,
    );
  });
});
