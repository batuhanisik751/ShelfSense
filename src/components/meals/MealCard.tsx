import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MealSuggestion } from '@/lib/validation/schemas';

export function MealCard({ meal }: { meal: MealSuggestion }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{meal.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{meal.reason}</p>
        <div className="flex flex-wrap gap-1">
          {meal.ingredients_used.map((ing) => (
            <Badge key={ing} variant="secondary">
              {ing}
            </Badge>
          ))}
          {meal.missing_ingredients.map((ing) => (
            <Badge key={ing} variant="outline">
              {ing}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
