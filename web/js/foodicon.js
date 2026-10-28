// Food tiles: an icon for the kind of food, worked out from its name (or picked by you on the food page).
// One style for every tile: a mint line icon on the app's raised fill, so lists read as one system.

// [kind, label, pattern]. Order matters: the first match wins ("peanut butter" is nuts, not dairy;
// "turkey bacon" is poultry, not pork; "protein powder" is powder, not dairy).
const KINDS = [
  ['supplement', 'Supplements & vitamins', /\b(capsules?|caps|tablets?|softgels?|gel ?caps?|supplements?|multi-?vitamins?|vitamins? [a-k]\d*|vitamin|probiotics?|prebiotic|fish oil|krill oil|omega-3 (capsules|softgels)|creatine|collagen|electrolytes?|magnesium (glycinate|citrate)|zinc|iron (tablets|supplement)|melatonin|ashwagandha|turmeric curcumin|biotin|greens powder|fiber supplement|psyllium)\b/],
  ['powder', 'Protein powder', /\b((protein|greens|collagen|meal replacement) powder|whey protein|whey isolate|casein protein|plant protein|pea protein|protein shake mix|mass gainer|pre-?workout)\b/],
  ['bar', 'Bars', /\b(protein bars?|granola bars?|energy bars?|snack bars?|bars?)\b/],
  ['shellfish', 'Shellfish', /\b(shrimp|prawns?|crab|lobster|scallops?|clams?|mussels?|oysters?|calamari|squid|octopus|crawfish)\b/],
  ['fish', 'Fish', /\b(salmon|tuna|cod|tilapia|trout|sardines?|anchov\w*|mackerel|halibut|haddock|pollock|herring|bass|snapper|catfish|swordfish|mahi|fish|seafood|lox)\b/],
  ['poultry', 'Poultry', /\b(chicken|turkey|duck|poultry|hen|quail|goose|wings?|drumsticks?)\b/],
  ['pork', 'Pork', /\b(pork|bacon|ham|prosciutto|pancetta|chorizo|pepperoni|salami|sausages?|bratwurst|hot dogs?|pig|lard)\b/],
  ['beef', 'Beef & red meat', /\b(beef|steak|veal|brisket|sirloin|ribeye|chuck|burgers?|hamburger|bison|lamb|mutton|goat|venison|jerky|meatballs?|meat|ribs?)\b/],
  ['egg', 'Eggs', /\b(eggs?|egg whites?|omelet\w*|frittata)\b/],
  ['nuts', 'Nuts & seeds', /\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|peanuts?|hazelnuts?|macadamia|brazil nuts?|nuts?|(?<!(fennel|mustard|cumin|coriander|caraway|celery|dill|anise|nigella) )seeds?|chia|flax\w*|hemp hearts|tahini|sesame|trail mix|nut butter|almond butter|peanut butter)\b/],
  ['legume', 'Beans & legumes', /\b(beans?|lentils?|chickpeas?|garbanzo|hummus|tofu|tempeh|edamame|split peas|black-eyed|soybeans?|refried)\b/],
  ['cheese', 'Cheese', /\b(cheese|cheddar|mozzarella|parmesan|parmigiano|feta|brie|gouda|swiss|provolone|ricotta|cottage cheese|cream cheese|halloumi|goat cheese|string cheese)\b/],
  ['dairy', 'Milk & yogurt', /\b(milk|yogh?urts?|kefir|whey|casein|cream|skyr|half and half|creamer)\b/],
  ['oil', 'Oils & fats', /\b(oils?|olive oil|butter|ghee|lard|shortening|margarine|mayo\w*|tallow)\b/],
  ['sweets', 'Sweets & desserts', /\b(chocolate|candy|candies|cookies?|cakes?|brownies?|donuts?|doughnuts?|pastr(y|ies)|pie|ice cream|gelato|sorbet|pudding|sugar|honey|syrup|maple|jam|jelly|marshmallows?|caramel|frosting|dessert|gummies|gummy)\b/],
  ['snack', 'Chips & snacks', /\b(chips|crisps|pretzels?|popcorn|crackers?|puffs|rice cakes?|snacks?|tortilla chips|pita chips)\b/],
  ['bread', 'Bread & bakery', /\b(bread|bagels?|tortillas?|buns?|rolls?|toast|pita|wraps?|naan|baguette|sourdough|english muffins?|muffins?|croissants?|ezekiel|sprouted grain bread)\b/],
  ['grain', 'Grains, rice & pasta', /\b(oats?|oatmeal|rice|wheat|pasta|spaghetti|macaroni|noodles?|cereal|quinoa|barley|flour|granola|buckwheat|millet|couscous|rye|farro|grits|polenta|pancakes?|waffles?|bulgur|amaranth)\b/],
  ['herbs', 'Herbs & spices', /^(?!.*\b(sauce|pesto|dressing|marinade|tea|soda|ale|beer)\b).*\b(herbs?|spices?|seasonings?|spice blend|rub|basil|oregano|thyme|rosemary|sage|parsley|cilantro|coriander|dill|mint leaves|bay leaf|bay leaves|tarragon|chives|marjoram|cumin|paprika|turmeric|cinnamon|nutmeg|cloves|cardamom|allspice|ginger(?! ale| beer)|cayenne|chill?i powder|chill?i flakes|curry powder|garam masala|black pepper|white pepper|peppercorns?|red pepper flakes|garlic powder|onion powder|za'?atar|sumac|saffron|fennel|mustard seeds?|caraway|star anise|anise|vanilla (bean|extract)|msg|salt)\b/],
  ['fruit', 'Fruit', /\b(apples?|bananas?|berr(y|ies)|strawberr\w*|blueberr\w*|raspberr\w*|blackberr\w*|oranges?|grapes?|mangos?|mangoes|pears?|peaches?|cherr(y|ies)|plums?|melons?|watermelon|cantaloupe|fruits?|kiwis?|pineapples?|lemons?|limes?|avocados?|figs?|dates|raisins?|apricots?|pomegranates?|papayas?|coconut|grapefruit|clementines?|tangerines?|nectarines?|prunes?|cranberr\w*)\b/],
  ['veg', 'Vegetables', /\b(broccoli|spinach|kale|lettuce|cabbage|kimchi|sauerkraut|carrots?|peppers?|tomato(es)?|onions?|garlic|potato(es)?|sweet potato(es)?|peas|vegetables?|veggies?|squash|zucchini|cucumbers?|pickles?|celery|mushrooms?|cauliflower|asparagus|beets?|greens|arugula|salad|corn|eggplant|okra|radish\w*|leeks?|brussels|artichokes?|bok choy|chard|collards?|sprouts|seaweed|nori)\b/],
  ['sauce', 'Sauces & condiments', /\b(sauce|ketchup|mustard|dressing|salsa|vinegar|soy sauce|tamari|sriracha|hot sauce|marinade|gravy|pesto|relish|bouillon|aioli|guacamole)\b/],
  ['soup', 'Soups & bowls', /\b(soup|broth|stock|stew|chili|ramen|pho|chowder|bisque|bone broth|curry|bowl)\b/],
  ['coffee', 'Coffee & tea', /\b(coffee|espresso|latte|cappuccino|americano|cold brew|tea|matcha|chai)\b/],
  ['drink', 'Drinks', /\b(juice|soda|water|sparkling|kombucha|smoothie|lemonade|cola|beer|wine|spirits?|vodka|whiskey|drink|beverage|energy drink|sports drink|seltzer|ginger ale|ginger beer)\b/],
  ['meal', 'Meals & dishes', /\b(sandwich|pizza|burrito|tacos?|wrap|sushi|lasagna|casserole|meal|entree|dinner|lunch|bowl|plate|platter|quesadilla|dumplings?)\b/]
];

export const FOOD_KINDS = KINDS.map(([kind, label]) => ({ kind, label }));

export function foodKind(food) {
  if (food?.kind && ICON[food.kind]) return food.kind;
  const text = `${food?.name || ''}`.toLowerCase();
  for (const [kind, , re] of KINDS) if (re.test(text)) return kind;
  return 'meal';
}

const dot = (x, y, r = 0.85) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const ICON = {
  veg: `<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15"/><path d="M5 19c3-4 6-7 10-9"/>`,
  fruit: `<path d="M12 7.5c-1.6-1.1-5.3-1.4-6.7 1.7-1.3 2.9-.4 7.3 2.2 9.9 1.5 1.5 3 1.3 4.5.6 1.5.7 3 .9 4.5-.6 2.6-2.6 3.5-7 2.2-9.9C17.3 6.1 13.6 6.4 12 7.5z"/><path d="M12 7.5c0-2.2 1-3.7 3-4.5"/>`,
  fish: `<path d="M2.5 12c3-4.5 9-6 13.5-2.5L21 6.5l-1.3 5.5 1.3 5.5-5-3C11.5 18 5.5 16.5 2.5 12z"/>${dot(7.5, 11, 0.9)}`,
  shellfish: `<path d="M4 11.5a8 8 0 0 1 16 0L15.2 18H8.8z"/><path d="M12 18V3.8M9.2 18 7.4 5.2M14.8 18l1.8-12.8M5.6 15.2 4 11.5M18.4 15.2 20 11.5"/><path d="M9.5 21h5"/>`,
  beef: `<path d="M7 9h10v4.5c0 3.2-2.2 6-5 6s-5-2.8-5-6z"/><path d="M7 9.5C4.8 9.5 3.3 8 3.3 5.8M17 9.5c2.2 0 3.7-1.5 3.7-3.7"/><path d="M7 11l-3 1M17 11l3 1"/><ellipse cx="12" cy="16.3" rx="3" ry="2"/>${dot(9.7, 12, 0.8)}${dot(14.3, 12, 0.8)}`,
  pork: `<circle cx="12" cy="13" r="7"/><path d="M6.8 8.6 5.4 4.6l4.1 2M17.2 8.6l1.4-4-4.1 2"/><ellipse cx="12" cy="15" rx="2.7" ry="1.9"/>${dot(11, 15, 0.55)}${dot(13, 15, 0.55)}${dot(9.4, 11, 0.8)}${dot(14.6, 11, 0.8)}`,
  poultry: `<path d="M6.4 10.4C5.6 7.4 6.6 4.6 8.8 4.6s3 1.8 2.7 3.8c-.2 1.6.9 2.6 2.4 2.1l5.3-3.3c1.3 5.2-.6 10.6-6.2 10.6H10c-2.7 0-4.4-2.6-3.6-7.4z"/><path d="M6.5 6.9 4.3 8l2.1.9"/><path d="M7.7 4.7c-.4-1.2.4-2 1.3-1.7.4-.8 1.6-.8 1.9.1.8 0 1.2.8.8 1.6"/><path d="M6.4 10.2c-.6.6-.4 1.8.4 1.9"/><path d="M10.5 12.5c1.4 1.8 4.2 1.9 5.8-.2"/><path d="M11 17.8V21M14.2 17.8V21M9.8 21h2.4M13 21h2.4"/>${dot(8.6, 6.9)}`,
  herbs: `<path d="M3.5 12h17c0 4.3-3.8 7.4-8.5 7.4S3.5 16.3 3.5 12z"/><path d="M9.5 19.4 9 21h6l-.5-1.6"/><path d="M13.6 12 18.8 4.2a1.4 1.4 0 0 1 2.3 1.6L15.9 12"/><path d="M6.2 12C5.4 8.8 7 6.2 10.4 5.6c.6 3.2-1 5.6-4.2 6.4z"/><path d="M6.2 12c1-1.9 2.2-3.4 3.6-4.5"/>`,
  egg: `<path d="M12 3c3.6 0 6.2 5.6 6.2 10.2a6.2 6.2 0 0 1-12.4 0C5.8 8.6 8.4 3 12 3z"/>`,
  nuts: `<path d="M4.5 10c0-3 3.4-5 7.5-5s7.5 2 7.5 5z"/><path d="M12 5V2.8"/><path d="M5.6 10c.3 5 3.1 9 6.4 10.5 3.3-1.5 6.1-5.5 6.4-10.5"/>`,
  legume: `<path d="M3.8 16.6c3.2-.7 4.6-4.6 7.6-7.6s6.9-4.6 8.6-2.9-.4 5.6-3.4 8.6-6.9 4.4-10.2 4.4c-1.6 0-2.9-1.2-2.6-2.5z"/>${dot(8.6, 14.6, 1.25)}${dot(12.3, 11, 1.25)}${dot(15.9, 7.9, 1.25)}`,
  cheese: `<path d="M3 12.5 15 5.5l6 4V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 12.5h18"/><circle cx="7.5" cy="15.6" r="1.1"/><circle cx="13.2" cy="16" r="1.3"/><circle cx="17.6" cy="15" r=".8"/>`,
  dairy: `<path d="M8 3h8v3l2.2 3.3V21H5.8V9.3L8 6z"/><path d="M5.8 9.3h12.4M8 6h8"/><path d="M9.5 14h5"/>`,
  oil: `<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.3 14.3a2.7 2.7 0 0 0 2.7 2.7"/>`,
  sweets: `<path d="M20.4 11.2A8.5 8.5 0 1 1 12.8 3.6a2.6 2.6 0 0 0 3.2 3.2 2.6 2.6 0 0 0 4.4 4.4z"/>${dot(8.6, 9.2, 1)}${dot(13.6, 12.2, 1)}${dot(9.2, 15.4, 1)}${dot(15, 16.6, 0.85)}`,
  snack: `<path d="M6.5 3h11l-1 2.25 1 2.25-1 2.25 1 2.25-1 2.25 1 2.25-1 2.25 1 2.25h-11l1-2.25-1-2.25 1-2.25-1-2.25 1-2.25-1-2.25 1-2.25z"/><path d="M9.5 10.5c1.5-1 3.5-1 5 0"/>`,
  bar: `<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 8v8M17 8v8"/><path d="M10 11h4M10 13h2.5"/>`,
  bread: `<path d="M5 11.3A3.6 3.6 0 0 1 3.5 4.8C5 3.8 8 3.2 12 3.2s7 .6 8.5 1.6a3.6 3.6 0 0 1-1.5 6.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M9 7.5l1.5 2M13.2 7l1.5 2"/>`,
  grain: `<path d="M12 21V7"/><path d="M12 7c-1.8-.9-2.7-2.6-2.7-4.4 1.8 0 2.7 1.7 2.7 4.4zm0 0c1.8-.9 2.7-2.6 2.7-4.4-1.8 0-2.7 1.7-2.7 4.4z"/><path d="M12 12c-2.3 0-3.8-1.4-4.3-3.3 2.3 0 3.8 1.4 4.3 3.3zm0 0c2.3 0 3.8-1.4 4.3-3.3-2.3 0-3.8 1.4-4.3 3.3zM12 17c-2.3 0-3.8-1.4-4.3-3.3 2.3 0 3.8 1.4 4.3 3.3zm0 0c2.3 0 3.8-1.4 4.3-3.3-2.3 0-3.8 1.4-4.3 3.3z"/>`,
  sauce: `<path d="M10 2.8h4v2.7l1.8 2.7V20a1.2 1.2 0 0 1-1.2 1.2H9.4A1.2 1.2 0 0 1 8.2 20V8.2L10 5.5z"/><path d="M8.2 11.5h7.6M8.2 16.5h7.6"/>`,
  soup: `<path d="M3 11.5h18a9 9 0 0 1-18 0z"/><path d="M8 8c0-1.6 1.2-1.6 1.2-3.4M12 8c0-1.6 1.2-1.6 1.2-3.4M16 8c0-1.6 1.2-1.6 1.2-3.4"/>`,
  coffee: `<path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8.5 3.5v2M11.5 3.5v2"/>`,
  drink: `<path d="M6 3h12l-1.6 16.6A1.6 1.6 0 0 1 14.8 21H9.2a1.6 1.6 0 0 1-1.6-1.4z"/><path d="M6.5 8.5h11"/><path d="M14 3l2.5-1.5"/>`,
  supplement: `<rect x="6.5" y="2.8" width="11" height="3.6" rx="1"/><path d="M7.2 6.4h9.6v13.2a1.6 1.6 0 0 1-1.6 1.6H8.8a1.6 1.6 0 0 1-1.6-1.6z"/><path d="M7.2 10.5h9.6v6.5H7.2"/><path d="M12 12.2v3.1M10.45 13.75h3.1"/>`,
  powder: `<path d="M5.5 8.5h13l-1 11a1.8 1.8 0 0 1-1.8 1.6H8.3a1.8 1.8 0 0 1-1.8-1.6z"/><rect x="4.5" y="4.5" width="15" height="4" rx="1.2"/><path d="M9.5 13.5h5"/><path d="M14.5 2.5c1.6 0 3 .6 3.8 1.8"/>`,
  meal: `<circle cx="14" cy="12" r="7"/><circle cx="14" cy="12" r="3.6"/><path d="M3.5 3.5v4.3a1.8 1.8 0 0 0 3.6 0V3.5M5.3 3.5v17"/>`
};

export function kindIcon(kind, size) {
  const s = Math.round(size * 0.52);
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[kind] || ICON.meal}</svg>`;
}

// Rounded tile with the food's icon.
export function foodTile(food, size = 44) {
  const r = Math.round(size * 0.3);
  return `<span class="food-tile" aria-hidden="true" style="width:${size}px;height:${size}px;border-radius:${r}px">${kindIcon(foodKind(food), size)}</span>`;
}
