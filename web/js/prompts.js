// The nutrient prompt: the user's Cronometer-style request plus a strict line format the app can read back.
// Used by the Ask Gemini button (Gemini app) and by the page-reading lookup (Gemini API).
import { isPlaceholderServing } from './api.js';
import { fmt } from './nutrients.js';

export function geminiPromptBody() {
  return `From this point forward, whenever I ask you to analyze, evaluate, or search for a food item, meal, or ingredient, you must provide a comprehensive nutritional breakdown using the complete Cronometer-based profile.

Do not limit your output to standard core macros and minimums. Every analysis must systematically evaluate and report all available parameters across the following categories:

* **Energy & General:** Energy (kcal, kJ), Alcohol, Ash, Beta-Hydroxybutyrate, Caffeine, Oxalate, Phytate, and Water.
* **Carbohydrates:** Total Carbs, Fiber (Insoluble, Soluble), Starch, Sugars (Allulose, Fructose, Galactose, Glucose, Lactose, Maltose, Sucrose, Added Sugars), and Sugar Alcohols.
* **Lipids:** Total Fat, Monounsaturated, Polyunsaturated, Omega-3 (ALA, DHA, EPA), Omega-6 (AA, LA), Saturated, Trans-Fats, Cholesterol, and Phytosterols.
* **Protein & Amino Acids:** Total Protein, plus all individual amino acids: Alanine, Arginine, Aspartic acid, Cystine, Glutamic acid, Glycine, Histidine, Hydroxyproline, Isoleucine, Leucine, Lysine, Methionine, Phenylalanine, Proline, Serine, Threonine, Tryptophan, Tyrosine, and Valine.
* **Vitamins:** B1 (Thiamine), B2 (Riboflavin), B3 (Niacin), B5 (Pantothenic Acid), B6 (Pyridoxine), B12 (Cobalamin), Biotin, Choline, Folate, Vitamin A (including Alpha-carotene, Beta-carotene, Beta-cryptoxanthin, Lutein+Zeaxanthin, Lycopene, and Retinol), Vitamin C, Vitamin D, Vitamin E (including Alpha, Beta, Delta, and Gamma tocopherols), and Vitamin K.
* **Minerals:** Calcium, Chromium, Copper, Fluoride, Iodine, Iron, Magnesium, Manganese, Molybdenum, Phosphorus, Potassium, Selenium, Sodium, and Zinc.

If specific micronutrient or sub-fraction data for an item is unavailable or estimated, explicitly note it rather than omitting the metric. Maintain maximum analytical depth and precision across all values.

Output format (strict):
- First line: Product: <brand> – <product name>
- Second line: Serving size: <household measure> (<grams> g)
- Then the category headings above, each followed by one line per nutrient: "Nutrient: number unit", for one serving.
- One number per nutrient: no ranges, no "<", no "~". If a value is estimated, write it and add (est.) at the end of the line. If it's unavailable, write "Nutrient: unavailable".
- No introduction, explanations, notes, sources or commentary, and nothing in parentheses except (est.) and the serving grams.`;
}

export function geminiNutrientPrompt(food) {
  const serving = food.servings?.find((x) => x.grams > 0 && !isPlaceholderServing(x));
  if (food.unidentified) {
    return geminiPromptBody() + `\n\nFood item: the product with barcode (UPC/EAN) ${food.upc}. Identify it first (search the barcode the way Google Lens would). Start your answer with these two lines:\nProduct: <brand> – <product name>\nServing size: <household measure> (<grams> g)\nThen give the breakdown for one serving.`;
  }
  const item = [
    `Food item: ${[food.brand, food.name].filter(Boolean).join(' ')}`,
    food.upc ? `Barcode: ${food.upc}` : '',
    serving ? `Label serving size: ${/\d\s*g\b/i.test(serving.label) ? serving.label : `${serving.label} (${fmt(serving.grams)} g)`}` : ''
  ].filter(Boolean).join('\n');
  return `${geminiPromptBody()}

${item}`;
}
