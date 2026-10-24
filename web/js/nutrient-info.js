// Reference information for the nutrient detail page.
// ul: Tolerable Upper Intake Level for adults 19–50 (National Academies), in the catalog unit.
// ulNote: when the limit only applies to some forms. fn: what it does. src: common food sources.
// Targets themselves come from the user's settings (defaults in nutrients.js).

const AMINO = (role) => ({
  fn: `An amino acid your body uses to build protein. ${role}`,
  src: 'Meat, fish, eggs, dairy, soy, legumes, and whey or other complete protein powders.'
});
const ESSENTIAL = 'It is essential, so it has to come from food.';

export const INFO = {
  energy: { fn: 'Calories are the energy in food. Eating more than you burn over time leads to weight gain; less leads to weight loss.', src: 'All foods with protein (4 kcal per gram), carbohydrate (4), fat (9) or alcohol (7).' },
  water: { fn: 'Water carries nutrients, regulates body temperature and cushions joints. This counts water in food and drinks you log.', src: 'Drinking water, other drinks, fruit, vegetables, soups.' },
  caffeine: { fn: 'A stimulant that increases alertness. Up to about 400 mg a day is considered safe for most healthy adults.', src: 'Coffee, tea, energy drinks, soda, dark chocolate.', ul: 400, ulNote: 'Common safety guideline, not a formal upper limit.' },
  alcohol: { fn: 'Provides 7 kcal per gram with no nutritional benefit. Health guidelines recommend limiting it.', src: 'Beer, wine and spirits.' },

  carbs: { fn: 'Your body’s preferred quick energy source, especially for the brain and intense exercise.', src: 'Grains, fruit, starchy vegetables, legumes, dairy, sweets.' },
  fiber: { fn: 'Supports digestion and regularity, feeds healthy gut bacteria, and helps manage blood sugar and cholesterol.', src: 'Beans, lentils, whole grains, vegetables, fruit, nuts and seeds like chia and flax.' },
  starch: { fn: 'A complex carbohydrate that breaks down into glucose for energy.', src: 'Potatoes, rice, bread, pasta, oats, corn, beans.' },
  sugars: { fn: 'Simple carbohydrates for quick energy. Natural sugars in fruit and milk come with other nutrients.', src: 'Fruit, milk, honey, sweets, sweetened drinks.' },
  added_sugars: { fn: 'Sugars added during processing or cooking. Guidelines suggest keeping them under 10% of calories.', src: 'Soda, sweets, baked goods, flavored yogurt, sauces, cereal.' },

  fat: { fn: 'Supplies energy, helps absorb vitamins A, D, E and K, and builds cell membranes and hormones.', src: 'Oils, butter, nuts, seeds, avocado, meat, fish, eggs, dairy.' },
  sat_fat: { fn: 'Solid at room temperature. Diets high in it can raise LDL cholesterol, so guidelines suggest under 10% of calories.', src: 'Butter, cheese, fatty meat, coconut and palm oil.' },
  mono_fat: { fn: 'A heart-friendly fat that can help improve cholesterol levels.', src: 'Olive oil, avocado, almonds, peanuts, cashews.' },
  poly_fat: { fn: 'Includes the essential omega-3 and omega-6 fats your body can’t make.', src: 'Walnuts, seeds, fatty fish, sunflower and soybean oils.' },
  trans_fat: { fn: 'Raises LDL and lowers HDL cholesterol. Best kept as low as possible.', src: 'Some fried and packaged baked goods; small natural amounts in meat and dairy.' },
  omega3: { fn: 'Essential fats that support heart, brain and eye health and help regulate inflammation.', src: 'Salmon, sardines, mackerel, chia, flax, walnuts.' },
  ala: { fn: 'The plant omega-3. Your body converts a small amount into EPA and DHA.', src: 'Flax, chia, walnuts, hemp seeds, canola oil.' },
  epa: { fn: 'A marine omega-3 that helps regulate inflammation and supports heart health.', src: 'Salmon, sardines, mackerel, herring, fish oil.' },
  dha: { fn: 'A marine omega-3 concentrated in the brain and eyes.', src: 'Salmon, sardines, trout, fish oil, algae oil.' },
  omega6: { fn: 'Essential fats for skin, hair and metabolism. Balance with omega-3 matters more than the total.', src: 'Sunflower, soybean and corn oils, nuts, seeds, poultry.' },
  la: { fn: 'The main omega-6 fat. Essential, so it has to come from food.', src: 'Vegetable oils, nuts, seeds.' },
  aa: { fn: 'An omega-6 fat involved in inflammation signaling and muscle repair.', src: 'Eggs, poultry, meat, fish.' },
  energy_kj: { fn: 'The same food energy as calories, in kilojoules (1 kcal = 4.184 kJ). Used on labels outside the US.', src: 'Worked out from calories.' },
  ash: { fn: 'What’s left after a food is burned in a lab: its total mineral content. Not a nutrient in itself.', src: 'Measured by labs; higher in mineral-rich foods like nuts, seeds and leafy greens.' },
  bhb: { fn: 'Beta-hydroxybutyrate is a ketone body your body makes from fat during fasting or very low-carb eating. It’s also sold as a supplement.', src: 'Ketone supplements and drinks; your own liver.' },
  oxalate: { fn: 'A plant compound that binds calcium. People prone to calcium-oxalate kidney stones are often advised to limit it.', src: 'Spinach, rhubarb, beets, almonds, cashews, cocoa, black tea.' },
  phytate: { fn: 'Phytic acid stores phosphorus in seeds. It can reduce how much iron, zinc and calcium you absorb from the same meal.', src: 'Whole grains, legumes, nuts and seeds. Soaking, sprouting and fermenting lower it.' },
  fiber_insol: { fn: 'Fiber that doesn’t dissolve in water. It adds bulk and helps food move through your gut.', src: 'Wheat bran, whole grains, nuts, vegetable and fruit skins.' },
  fiber_sol: { fn: 'Fiber that dissolves into a gel. It helps lower LDL cholesterol and slows sugar absorption.', src: 'Oats, barley, beans, lentils, apples, citrus, psyllium.' },
  allulose: { fn: 'A rare sugar with about a tenth of sugar’s calories that barely raises blood sugar. US labels don’t count it as added sugar.', src: 'Low-sugar sweeteners and “keto” products; tiny amounts in figs and raisins.' },
  fructose: { fn: 'Fruit sugar. Processed mainly by the liver; large amounts from sweetened drinks are linked to fatty liver.', src: 'Fruit, honey, agave, high-fructose corn syrup, table sugar (half fructose).' },
  galactose: { fn: 'A simple sugar that, with glucose, makes up lactose.', src: 'Dairy, especially fermented dairy like yogurt.' },
  glucose: { fn: 'The sugar in your blood and your cells’ main fuel. Starch breaks down into glucose.', src: 'Fruit, honey, corn syrup, and every starchy food once digested.' },
  lactose: { fn: 'Milk sugar. People with lactose intolerance lack enough of the enzyme that digests it.', src: 'Milk, ice cream, soft cheeses, whey. Hard cheeses and yogurt have little.' },
  maltose: { fn: 'Two glucose units; formed when starch breaks down.', src: 'Malted grains, beer, malt syrup, some breakfast cereals.' },
  sucrose: { fn: 'Table sugar: one glucose plus one fructose.', src: 'Sugar, sweets, baked goods, and naturally in fruit and some vegetables.' },
  sugar_alcohols: { fn: 'Sweeteners like erythritol, xylitol and maltitol with fewer calories than sugar. Large amounts can cause bloating.', src: 'Sugar-free gum, candy and “keto” products.' },
  phytosterols: { fn: 'Plant compounds that resemble cholesterol and block some of its absorption, lowering LDL cholesterol.', src: 'Vegetable oils, nuts, seeds, legumes, fortified spreads.' },
  cryptoxanthin: { fn: 'A carotenoid your body can turn into vitamin A; also an antioxidant.', src: 'Tangerines, oranges, persimmons, papaya, red peppers.' },
  toco_alpha: { fn: 'The form of vitamin E your body keeps and uses; vitamin E targets are based on it.', src: 'Sunflower seeds, almonds, hazelnuts, spinach, plant oils.' },
  toco_beta: { fn: 'A less active form of vitamin E.', src: 'Wheat germ and some plant oils.' },
  toco_gamma: { fn: 'The most common form of vitamin E in the US diet. It doesn’t count toward vitamin E targets but is an antioxidant.', src: 'Soybean and corn oil, walnuts, pecans, pistachios.' },
  toco_delta: { fn: 'A minor form of vitamin E with antioxidant activity.', src: 'Soybean oil and some other plant oils.' },
  cholesterol: { fn: 'Your body makes its own cholesterol for cells and hormones. Dietary cholesterol affects blood levels less than saturated fat does for most people.', src: 'Eggs, shellfish, meat, dairy.' },

  protein: { fn: 'Builds and repairs muscle and tissue, and makes enzymes, hormones and antibodies.', src: 'Meat, fish, eggs, dairy, legumes, tofu, protein powders.' },
  cystine: AMINO('It supports antioxidant production (glutathione) and the structure of hair, skin and nails.'),
  histidine: AMINO(`It is used to make histamine and helps maintain nerve cells. ${ESSENTIAL}`),
  isoleucine: AMINO(`A branched-chain amino acid (BCAA) involved in muscle repair and energy. ${ESSENTIAL}`),
  leucine: AMINO(`The BCAA most responsible for switching on muscle building after a meal. ${ESSENTIAL}`),
  lysine: AMINO(`It supports collagen formation and calcium absorption. ${ESSENTIAL}`),
  methionine: AMINO(`It starts protein building and provides sulfur for other compounds. ${ESSENTIAL}`),
  phenylalanine: AMINO(`It is used to make tyrosine and the brain chemicals dopamine and norepinephrine. ${ESSENTIAL}`),
  threonine: AMINO(`It helps build collagen and elastin and supports gut lining. ${ESSENTIAL}`),
  tryptophan: { ...AMINO(`It is used to make serotonin, melatonin and niacin. ${ESSENTIAL}`), src: 'Turkey, chicken, eggs, dairy, fish, oats, seeds. Collagen contains almost none.' },
  tyrosine: AMINO('It is used to make thyroid hormones and the brain chemicals dopamine and adrenaline.'),
  valine: AMINO(`A branched-chain amino acid (BCAA) that supports muscle repair and energy. ${ESSENTIAL}`),
  alanine: AMINO('It helps move nitrogen around the body and supports blood sugar control during exercise.'),
  arginine: AMINO('It is used to make nitric oxide, which helps blood vessels relax.'),
  aspartic_acid: AMINO('It plays a part in energy production and making other amino acids.'),
  glutamic_acid: AMINO('It is the most common amino acid in many proteins and fuels gut cells.'),
  glycine: { ...AMINO('About a third of collagen is glycine. It also supports sleep quality and acts as a calming signal in the nervous system.'), src: 'Collagen and gelatin, bone broth, meat, fish skin.' },
  proline: { ...AMINO('A main building block of collagen, supporting skin, tendons and joints.'), src: 'Collagen and gelatin, bone broth, dairy, meat.' },
  serine: AMINO('It is used to make cell membranes and brain chemicals.'),
  hydroxyproline: { fn: 'An amino acid found almost only in collagen. It gives collagen its strength and stability.', src: 'Collagen peptides, gelatin, bone broth, skin and connective tissue.' },

  b1: { fn: 'Helps turn carbohydrates into energy and supports nerve function.', src: 'Pork, whole and enriched grains, beans, sunflower seeds.' },
  b2: { fn: 'Helps produce energy and supports skin, eyes and red blood cells.', src: 'Dairy, eggs, meat, almonds, mushrooms, enriched grains.' },
  b3: { fn: 'Helps convert food into energy and supports skin and nerves.', src: 'Chicken, tuna, salmon, peanuts, enriched grains.', ul: 35, ulNote: 'Applies to niacin from supplements and fortified foods only.' },
  b5: { fn: 'Needed to make coenzyme A, which is central to energy and fat metabolism.', src: 'Meat, eggs, mushrooms, avocado, whole grains.' },
  b6: { fn: 'Supports protein metabolism, brain chemicals and red blood cell formation.', src: 'Chickpeas, poultry, fish, potatoes, bananas.', ul: 100 },
  b12: { fn: 'Keeps nerves and blood cells healthy and helps make DNA. Found almost only in animal foods.', src: 'Meat, fish, eggs, dairy, fortified foods.' },
  biotin: { fn: 'Helps metabolize fats, carbohydrates and protein. Supports hair, skin and nails.', src: 'Eggs, nuts, seeds, salmon, sweet potato.' },
  choline: { fn: 'Supports brain function, memory, muscle control and liver health.', src: 'Eggs, beef, chicken, fish, soybeans.', ul: 3500 },
  folate: { fn: 'Needed to make DNA and new cells. Especially important before and during pregnancy.', src: 'Leafy greens, beans, lentils, asparagus, fortified grains.', ul: 1000, ulNote: 'Applies to folic acid from supplements and fortified foods only.' },
  vit_a: { fn: 'Supports vision, immune function and skin. Includes retinol and carotenoids your body converts.', src: 'Sweet potato, carrots, leafy greens, eggs, liver, dairy.' },
  retinol: { fn: 'The preformed vitamin A from animal foods and supplements. Too much can be harmful, unlike beta-carotene.', src: 'Liver, eggs, dairy, fortified foods.', ul: 3000 },
  beta_carotene: { fn: 'A plant pigment your body converts to vitamin A as needed. Also an antioxidant.', src: 'Carrots, sweet potato, spinach, kale, cantaloupe.' },
  alpha_carotene: { fn: 'A plant pigment your body can convert to vitamin A.', src: 'Carrots, pumpkin, winter squash.' },
  lutein: { fn: 'Antioxidants that collect in the eye and help protect it from light damage.', src: 'Kale, spinach, egg yolks, corn.' },
  lycopene: { fn: 'A red antioxidant pigment linked to heart and prostate health.', src: 'Tomatoes (especially cooked), watermelon, pink grapefruit.' },
  vit_c: { fn: 'An antioxidant that supports immune function, collagen production and iron absorption.', src: 'Citrus, berries, peppers, broccoli, kiwi.', ul: 2000 },
  vit_d: { fn: 'Helps you absorb calcium and supports bone, muscle and immune health. Your skin also makes it from sunlight.', src: 'Fatty fish, egg yolks, fortified milk, sunlight.', ul: 4000 },
  vit_e: { fn: 'An antioxidant that protects cells from damage and supports immune function.', src: 'Almonds, sunflower seeds, spinach, avocado, plant oils.', ul: 1000, ulNote: 'Applies to vitamin E from supplements and fortified foods.' },
  vit_k: { fn: 'Needed for blood clotting and bone health.', src: 'Kale, spinach, broccoli, Brussels sprouts, natto.' },

  calcium: { fn: 'Builds and maintains bones and teeth, and is used in muscle contraction, blood clotting and nerve signaling. High magnesium intake can limit calcium absorption, so check the calcium : magnesium balance in your report.', src: 'Milk, cheese, yogurt, salmon with bones, tofu, spinach, okra.', ul: 2500 },
  chromium: { fn: 'Helps insulin work and supports blood sugar control. Rarely measured in food, so values are often estimates.', src: 'Broccoli, grapes, whole grains, meat, brewer’s yeast.' },
  copper: { fn: 'Helps make red blood cells and supports nerves, immunity and iron use.', src: 'Shellfish, nuts, seeds, organ meats, dark chocolate.', ul: 10 },
  fluoride: { fn: 'Strengthens tooth enamel and helps prevent cavities.', src: 'Fluoridated water, tea, seafood.', ul: 10000 },
  iodine: { fn: 'Needed to make thyroid hormones, which control metabolism. Few labels list it, so values are often estimates.', src: 'Iodized salt, seaweed, fish, dairy, eggs.', ul: 1100 },
  iron: { fn: 'Carries oxygen in your blood and supports energy and focus. Vitamin C helps you absorb iron from plants.', src: 'Red meat, shellfish, beans, lentils, spinach, fortified grains.', ul: 45 },
  magnesium: { fn: 'Involved in over 300 processes, including muscle and nerve function, blood sugar and blood pressure.', src: 'Pumpkin seeds, almonds, spinach, black beans, dark chocolate.', ul: 350, ulNote: 'Applies to magnesium from supplements only, not food.' },
  manganese: { fn: 'Helps with bone formation, metabolism and antioxidant enzymes.', src: 'Whole grains, nuts, tea, pineapple, legumes.', ul: 11 },
  molybdenum: { fn: 'Helps enzymes break down certain amino acids and toxins. Rarely measured in food.', src: 'Legumes, whole grains, nuts.', ul: 2000 },
  phosphorus: { fn: 'Works with calcium to build bones and teeth, and helps make energy.', src: 'Meat, dairy, fish, beans, nuts, whole grains.', ul: 4000 },
  potassium: { fn: 'Balances fluids, supports muscle and nerve function, and helps offset sodium to manage blood pressure.', src: 'Potatoes, beans, bananas, avocado, spinach, yogurt.' },
  selenium: { fn: 'An antioxidant mineral that supports thyroid and immune function.', src: 'Brazil nuts, seafood, eggs, meat, whole grains.', ul: 400 },
  sodium: { fn: 'Regulates fluid balance and nerve signals. Most people get more than needed; high intake can raise blood pressure.', src: 'Salt, processed and restaurant foods, bread, cheese, sauces.', ul: 2300, ulNote: 'Chronic disease risk reduction level, not a toxicity limit.' },
  zinc: { fn: 'Supports immunity, wound healing, taste and smell, and protein building.', src: 'Oysters, beef, pumpkin seeds, chickpeas, cashews.', ul: 40 }
};

/* ---------------- Dietary Reference Intakes ---------------- */
// Values from the National Academies DRI tables. Each life stage group lists [value, type].
// type: RDA (Recommended Dietary Allowance) or AI (Adequate Intake).

export const MACRO_KEYS = ['energy', 'protein', 'carbs', 'fat'];

const R = (v) => [v, 'RDA'];
const A = (v) => [v, 'AI'];

// Shared by every group unless a group overrides it.
const BASE = { b12: R(2.4), folate: R(400), vit_d: R(600), vit_e: R(15), b5: A(5), biotin: A(30), iodine: R(150), molybdenum: R(45), phosphorus: R(700), selenium: R(55), sodium: A(1500), copper: R(0.9) };

const GROUPS = {
  // Teens 14–18
  m14: { water: A(3300), fiber: A(38), omega3: A(1.6), ala: A(1.6), omega6: A(16), la: A(16), b1: R(1.2), b2: R(1.3), b3: R(16), b6: R(1.3), biotin: A(25), choline: A(550), vit_a: R(900), vit_c: R(75), vit_k: A(75), calcium: R(1300), chromium: A(35), copper: R(0.89), fluoride: A(3000), iron: R(11), magnesium: R(410), manganese: A(2.2), molybdenum: R(43), phosphorus: R(1250), potassium: A(3000), zinc: R(11) },
  f14: { water: A(2300), fiber: A(26), omega3: A(1.1), ala: A(1.1), omega6: A(11), la: A(11), b1: R(1.0), b2: R(1.0), b3: R(14), b6: R(1.2), biotin: A(25), choline: A(400), vit_a: R(700), vit_c: R(65), vit_k: A(75), calcium: R(1300), chromium: A(24), copper: R(0.89), fluoride: A(3000), iron: R(15), magnesium: R(360), manganese: A(1.6), molybdenum: R(43), phosphorus: R(1250), potassium: A(2300), zinc: R(9) },
  // Adults
  m19: { water: A(3700), fiber: A(38), omega3: A(1.6), ala: A(1.6), omega6: A(17), la: A(17), b1: R(1.2), b2: R(1.3), b3: R(16), b6: R(1.3), choline: A(550), vit_a: R(900), vit_c: R(90), vit_k: A(120), calcium: R(1000), chromium: A(35), fluoride: A(4000), iron: R(8), magnesium: R(400), manganese: A(2.3), potassium: A(3400), zinc: R(11) },
  m31: { magnesium: R(420) },
  m51: { fiber: A(30), omega6: A(14), la: A(14), b6: R(1.7), chromium: A(30) },
  m71: { vit_d: R(800), calcium: R(1200) },
  f19: { water: A(2700), fiber: A(25), omega3: A(1.1), ala: A(1.1), omega6: A(12), la: A(12), b1: R(1.1), b2: R(1.1), b3: R(14), b6: R(1.3), choline: A(425), vit_a: R(700), vit_c: R(75), vit_k: A(90), calcium: R(1000), chromium: A(25), fluoride: A(3000), iron: R(18), magnesium: R(310), manganese: A(1.8), potassium: A(2600), zinc: R(8) },
  f31: { magnesium: R(320) },
  f51: { fiber: A(21), omega6: A(11), la: A(11), b6: R(1.5), chromium: A(20), calcium: R(1200), iron: R(8) },
  f71: { vit_d: R(800) },
  // Pregnancy and breastfeeding (ages 19–50)
  preg: { water: A(3000), fiber: A(28), omega3: A(1.4), ala: A(1.4), omega6: A(13), la: A(13), b1: R(1.4), b2: R(1.4), b3: R(18), b5: A(6), b6: R(1.9), b12: R(2.6), choline: A(450), folate: R(600), vit_a: R(770), vit_c: R(85), vit_k: A(90), calcium: R(1000), chromium: A(30), copper: R(1.0), fluoride: A(3000), iodine: R(220), iron: R(27), magnesium: R(350), manganese: A(2.0), molybdenum: R(50), potassium: A(2900), selenium: R(60), zinc: R(11) },
  preg31: { magnesium: R(360) },
  lact: { water: A(3800), fiber: A(29), omega3: A(1.3), ala: A(1.3), omega6: A(13), la: A(13), b1: R(1.4), b2: R(1.6), b3: R(17), b5: A(7), b6: R(2.0), b12: R(2.8), biotin: A(35), choline: A(550), folate: R(500), vit_a: R(1300), vit_c: R(120), vit_e: R(19), vit_k: A(90), calcium: R(1000), chromium: A(45), copper: R(1.3), fluoride: A(3000), iodine: R(290), iron: R(9), magnesium: R(310), manganese: A(2.6), molybdenum: R(50), potassium: A(2800), selenium: R(70), zinc: R(12) },
  lact31: { magnesium: R(320) }
};

// Tolerable Upper Intake Levels that differ from the adult values in INFO.
const UL_TEEN = { vit_a: 2800, retinol: 2800, vit_c: 1800, vit_e: 800, b3: 30, b6: 80, folate: 800, choline: 3000, calcium: 3000, copper: 8, iodine: 900, manganese: 9, molybdenum: 1700, zinc: 34 };

// Essential amino acid needs in mg per kg of body weight per day (RDA, adults).
const AMINO_MG_PER_KG = { histidine: 14, isoleucine: 19, leucine: 42, lysine: 38, methionine: 10.4, cystine: 8.6, phenylalanine: 17.2, tyrosine: 15.8, threonine: 20, tryptophan: 5, valine: 24 };

// Which table rows apply, most general first.
function layers({ sex, age, stage }) {
  const m = sex !== 'female';
  const a = Number(age) || 30;
  if (a < 19) return [m ? 'm14' : 'f14'];
  if (!m && stage === 'pregnant' && a <= 50) return ['f19', 'preg', ...(a > 30 ? ['preg31'] : [])];
  if (!m && stage === 'breastfeeding' && a <= 50) return ['f19', 'lact', ...(a > 30 ? ['lact31'] : [])];
  const p = m ? 'm' : 'f';
  return [`${p}19`, ...(a > 30 ? [`${p}31`] : []), ...(a > 50 ? [`${p}51`] : []), ...(a > 70 ? [`${p}71`] : [])];
}

export function driFor(key, opts = {}) {
  const { sex = 'male', age = 30, weightLbs = null, diet = 'omnivore', smoker = false } = opts;
  const m = sex !== 'female';
  if (key === 'added_sugars') return { value: 50, type: 'Limit', name: 'Dietary Guidelines limit', note: 'Less than 10% of calories on a 2,000 kcal diet.' };
  if (AMINO_MG_PER_KG[key]) {
    const kg = weightLbs ? weightLbs * 0.45359237 : (m ? 70 : 57);
    return { value: Math.round((AMINO_MG_PER_KG[key] * kg) / 100) / 10, type: 'RDA', perWeight: !!weightLbs };
  }
  let hit = BASE[key] || null;
  for (const g of layers(opts)) if (GROUPS[g][key]) hit = GROUPS[g][key];
  if (!hit) return null;
  let [value, type] = hit;
  const notes = [];
  if (key === 'iron' && (diet === 'vegetarian' || diet === 'vegan')) {
    value = Math.round(value * 1.8 * 10) / 10;
    notes.push('Raised 1.8× because iron from plants is absorbed less well.');
  }
  if (key === 'vit_c' && smoker) {
    value += 35;
    notes.push('Raised by 35 mg because smoking uses up vitamin C faster.');
  }
  if (key === 'b12' && diet === 'vegan') notes.push('B12 is found almost only in animal foods, so vegans need fortified foods or a supplement.');
  if (key === 'zinc' && (diet === 'vegetarian' || diet === 'vegan')) notes.push('Vegetarians may need up to 50% more zinc, since plant compounds reduce how much is absorbed.');
  if (key === 'folate' && sex === 'female' && opts.stage === 'pregnant') notes.push('Includes extra folate to support the baby’s development.');
  return { value, type, adjustedNote: notes.join(' ') || null };
}

// Upper limit for display. Sodium uses the Chronic Disease Risk Reduction intake.
export function ulFor(key, { age = 30, stage = 'none', sex = 'male' } = {}) {
  const i = INFO[key];
  if (!i?.ul) return null;
  const a = Number(age) || 30;
  if (key === 'sodium') return { value: 2300, name: 'Chronic Disease Risk Reduction (CDRR)', short: 'CDRR' };
  if (key === 'caffeine') {
    const preg = sex === 'female' && (stage === 'pregnant' || stage === 'breastfeeding');
    return { value: preg ? 200 : 400, name: preg ? 'Pregnancy and breastfeeding guideline' : 'Safety guideline', short: 'Limit' };
  }
  let value = i.ul;
  if (a < 19 && UL_TEEN[key] != null) value = UL_TEEN[key];
  if (key === 'calcium' && a >= 19) value = a > 50 ? 2000 : 2500;
  if (key === 'phosphorus') value = sex === 'female' && stage === 'pregnant' ? 3500 : a > 70 ? 3000 : 4000;
  return { value, name: 'Tolerable Upper Intake Level (UL)', short: 'UL' };
}

// Extra daily calories for pregnancy and breastfeeding (Dietary Reference Intakes, 2023).
export function lifeStageCalories({ sex, stage, trimester, months }) {
  if (sex !== 'female') return 0;
  if (stage === 'pregnant') return Number(trimester) === 3 ? 452 : Number(trimester) === 2 ? 340 : 0;
  if (stage === 'breastfeeding') return Number(months) === 2 ? 400 : 330;
  return 0;
}

export function describePerson({ sex, age, stage, trimester, months, diet, smoker }) {
  const f = sex === 'female';
  const who = age ? `${age}-year-old ${f ? 'woman' : 'man'}` : `adult ${f ? 'woman' : 'man'}`;
  const article = /^(8|11|18|8\d)-|^adult/.test(who) ? 'an' : 'a';
  const extra = [];
  const ord = ['', '1st', '2nd', '3rd'];
  if (f && stage === 'pregnant') extra.push(`pregnant, ${ord[Number(trimester) || 1]} trimester`);
  if (f && stage === 'breastfeeding') extra.push(`breastfeeding, ${Number(months) === 2 ? '7–12' : '0–6'} months`);
  if (diet === 'vegetarian' || diet === 'vegan') extra.push(diet);
  if (smoker) extra.push('smoker');
  return `${article} ${who}${extra.length ? ` (${extra.join('; ')})` : ''}`;
}

export const DRI_NAME = { RDA: 'Recommended Dietary Allowance (RDA)', AI: 'Adequate Intake (AI)' };
