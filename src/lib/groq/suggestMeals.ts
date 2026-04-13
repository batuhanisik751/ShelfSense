import type { MealSuggestion, PantryItemForSuggest } from '@/lib/validation/schemas';

export async function suggestMeals(_pantry: PantryItemForSuggest[]): Promise<MealSuggestion[]> {
  throw new Error('suggestMeals not implemented (Phase 3.2)');
}
