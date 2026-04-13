export type PantryStatus = 'fresh' | 'use_soon' | 'likely_expired';

export type EstimateInput = {
  category: string;
  purchasedAt: Date;
};

export type EstimateResult = {
  estimatedExpirationAt: Date;
  status: PantryStatus;
};

export async function estimateExpiration(
  _input: EstimateInput,
  _rules: Map<string, number>
): Promise<EstimateResult> {
  throw new Error('estimateExpiration not implemented (Phase 2.2)');
}
