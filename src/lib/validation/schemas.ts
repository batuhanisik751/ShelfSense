import { z } from 'zod';

export const parsedReceiptItemSchema = z.object({
  name: z.string().min(1),
  normalized_name: z.string().min(1),
  category: z.string().min(1),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
});

export const parsedReceiptSchema = z.object({
  items: z.array(parsedReceiptItemSchema),
});

export type ParsedReceiptItem = z.infer<typeof parsedReceiptItemSchema>;

export const pantryItemForSuggestSchema = z.object({
  name: z.string(),
  category: z.string(),
  status: z.enum(['fresh', 'use_soon']),
});

export type PantryItemForSuggest = z.infer<typeof pantryItemForSuggestSchema>;

export const mealSuggestionSchema = z.object({
  title: z.string().min(1),
  ingredients_used: z.array(z.string()),
  missing_ingredients: z.array(z.string()),
  reason: z.string().min(1),
});

export const mealSuggestionsResponseSchema = z.object({
  meals: z.array(mealSuggestionSchema),
});

export type MealSuggestion = z.infer<typeof mealSuggestionSchema>;
