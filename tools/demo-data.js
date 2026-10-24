// Demo data for screenshots: ~60 days of realistic logging, weights and workouts.
// Load with: page.evaluate(SPECTRA_DEMO) before opening the app. Values are USDA-style per 100 g.
(() => {
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const L = (o, src = 'lab') => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v, src }]));
  const food = (id, name, brand, servings, label, lab, est = {}) => ({ id, name, brand, servings, per100: { ...L(lab, 'lab'), ...L(est, 'est'), ...L(label, 'label') }, sources: [{ kind: 'label', title: 'Nutrition label', count: Object.keys(label).length }, { kind: 'lab', title: 'USDA FoodData Central', count: Object.keys(lab).length }, ...(Object.keys(est).length ? [{ kind: 'est', title: 'Estimated trace nutrients', count: Object.keys(est).length }] : [])], createdAt: Date.now() });
  const foods = [
    food('oats', 'Old Fashioned Rolled Oats', 'Quaker', [{ label: '1/2 cup (40 g)', grams: 40 }], { energy: 375, fat: 6.3, sat_fat: 1.3, carbs: 67.5, fiber: 10, sugars: 1.3, protein: 12.5, sodium: 0, iron: 4.5, potassium: 350 }, { magnesium: 138, zinc: 3.6, phosphorus: 410, b1: 0.46, b2: 0.16, b3: 1.1, b6: 0.12, folate: 32, copper: 0.39, manganese: 4.9, selenium: 28.9, calcium: 52, vit_e: 0.42, omega6: 2.4, omega3: 0.1, la: 2.4, ala: 0.1 }, { chromium: 4, molybdenum: 15 }),
    food('eggs', 'Large Eggs', 'Vital Farms', [{ label: '1 egg (50 g)', grams: 50 }], { energy: 140, fat: 10, sat_fat: 3, cholesterol: 370, sodium: 140, protein: 12, carbs: 0, vit_d: 2 }, { choline: 294, b12: 0.89, b2: 0.46, selenium: 31, vit_a: 160, phosphorus: 198, iron: 1.75, zinc: 1.3, folate: 47, b5: 1.5, calcium: 56, potassium: 138, vit_e: 1.05, omega6: 1.6, omega3: 0.1, la: 1.5, ala: 0.04, dha: 0.06, iodine: 50 }),
    food('yogurt', 'Plain Nonfat Greek Yogurt', 'Fage', [{ label: '3/4 cup (170 g)', grams: 170 }], { energy: 53, fat: 0, sat_fat: 0, carbs: 3.5, sugars: 3.5, protein: 10.6, sodium: 38, calcium: 112 }, { potassium: 141, phosphorus: 135, b12: 0.75, b2: 0.27, zinc: 0.52, selenium: 9.7, iodine: 30 }),
    food('blueberries', 'Blueberries', '', [{ label: '1 cup (148 g)', grams: 148 }], {}, { energy: 57, carbs: 14.5, fiber: 2.4, sugars: 10, protein: 0.7, fat: 0.3, vit_c: 9.7, vit_k: 19.3, manganese: 0.34, potassium: 77, vit_e: 0.57, copper: 0.06 }),
    food('chicken', 'Chicken Breast, roasted', '', [{ label: '4 oz (113 g)', grams: 113 }], {}, { energy: 165, protein: 31, fat: 3.6, sat_fat: 1, cholesterol: 85, sodium: 74, b3: 13.7, b6: 0.6, selenium: 27.6, phosphorus: 228, potassium: 256, zinc: 1, magnesium: 29, b5: 0.97, omega6: 0.6, omega3: 0.05, la: 0.55, ala: 0.03, choline: 85 }),
    food('rice', 'Brown Rice, cooked', '', [{ label: '1 cup (195 g)', grams: 195 }], {}, { energy: 123, carbs: 25.6, fiber: 1.6, protein: 2.7, fat: 1, manganese: 1.1, magnesium: 39, phosphorus: 103, selenium: 5.8, b3: 1.5, b1: 0.18, b6: 0.12, potassium: 86, zinc: 0.7 }),
    food('broccoli', 'Broccoli, steamed', '', [{ label: '1 cup (156 g)', grams: 156 }], {}, { energy: 35, carbs: 7.2, fiber: 3.3, protein: 2.4, fat: 0.4, vit_c: 64.9, vit_k: 141, folate: 108, potassium: 293, vit_a: 77, calcium: 40, iron: 0.67, magnesium: 21, manganese: 0.19, b6: 0.2, b2: 0.12, vit_e: 1.45, omega3: 0.12, ala: 0.12 }),
    food('salmon', 'Atlantic Salmon, baked', '', [{ label: '4 oz (113 g)', grams: 113 }], {}, { energy: 206, protein: 22, fat: 12.4, sat_fat: 2.5, sodium: 61, omega3: 2.3, omega6: 0.9, la: 0.7, ala: 0.1, epa: 0.69, dha: 1.46, vit_d: 526, b12: 2.8, selenium: 41, b3: 8, b6: 0.64, potassium: 384, phosphorus: 252, magnesium: 30, choline: 79 }),
    food('sweetpotato', 'Sweet Potato, baked', '', [{ label: '1 medium (150 g)', grams: 150 }], {}, { energy: 90, carbs: 20.7, fiber: 3.3, sugars: 6.5, protein: 2, fat: 0.2, vit_a: 961, vit_c: 19.6, potassium: 475, manganese: 0.5, b6: 0.29, magnesium: 27, copper: 0.16 }),
    food('almonds', 'Whole Almonds', 'Blue Diamond', [{ label: '1 oz (28 g)', grams: 28 }], { energy: 607, fat: 53.6, sat_fat: 3.6, carbs: 21.4, fiber: 10.7, sugars: 3.6, protein: 21.4, sodium: 0, calcium: 286, iron: 3.9, potassium: 714 }, { vit_e: 25.6, magnesium: 270, manganese: 2.2, b2: 1.1, phosphorus: 481, copper: 1, omega6: 12.3, la: 12.3, ala: 0.003, zinc: 3.1 }),
    food('banana', 'Banana', '', [{ label: '1 medium (118 g)', grams: 118 }], {}, { energy: 89, carbs: 22.8, fiber: 2.6, sugars: 12.2, protein: 1.1, fat: 0.3, potassium: 358, b6: 0.37, vit_c: 8.7, magnesium: 27, manganese: 0.27 }),
    food('spinach', 'Baby Spinach', 'Organic Girl', [{ label: '3 cups (85 g)', grams: 85 }], { energy: 24, carbs: 3.5, fiber: 2.4, protein: 2.4, sodium: 94, iron: 2.6, calcium: 118, potassium: 550 }, { vit_k: 483, vit_a: 469, folate: 194, magnesium: 79, vit_c: 28, manganese: 0.9, vit_e: 2, b2: 0.19, omega3: 0.14, ala: 0.14 }),
    food('avocado', 'Avocado', '', [{ label: '1/2 fruit (100 g)', grams: 100 }], {}, { energy: 160, fat: 14.7, sat_fat: 2.1, carbs: 8.5, fiber: 6.7, protein: 2, potassium: 485, folate: 81, vit_k: 21, vit_e: 2.1, b5: 1.4, b6: 0.26, vit_c: 10, magnesium: 29, copper: 0.19, omega6: 1.7, omega3: 0.11, la: 1.67, ala: 0.11 }),
    food('olive', 'Extra Virgin Olive Oil', 'California Olive Ranch', [{ label: '1 tbsp (14 g)', grams: 14 }], { energy: 857, fat: 100, sat_fat: 14.3, sodium: 0 }, { vit_e: 14.4, vit_k: 60, omega6: 9.8, omega3: 0.76, la: 9.8, ala: 0.76 }),
    food('whey', 'Gold Standard Whey, Double Rich Chocolate', 'Optimum Nutrition', [{ label: '1 scoop (31 g)', grams: 31 }], { energy: 387, fat: 4.8, sat_fat: 3.2, cholesterol: 113, sodium: 419, carbs: 9.7, sugars: 3.2, protein: 77.4, calcium: 452, potassium: 548 }, {}, { leucine: 8.4, isoleucine: 4.4, valine: 4.2, lysine: 7.1, iron: 1.2 }),
    food('vitd', 'Vitamin D3 2000 IU', 'Nature Made', [{ label: '1 softgel', grams: 1, nominal: true }], { vit_d: 200000, energy: 0 }, {}),
    food('pizza', 'Margherita Pizza', 'Local', [{ label: '1 slice (107 g)', grams: 107 }], {}, { energy: 250, carbs: 30, fiber: 1.9, protein: 11, fat: 9.6, sat_fat: 4.4, sodium: 560, calcium: 190, added_sugars: 2.5, potassium: 160 })
  ];
  foods.find((f) => f.id === 'oats').kind = 'grain';
  const byId = Object.fromEntries(foods.map((f) => [f.id, f]));
  const log = {}, weights = {}, acts = {};
  const now = new Date();
  let w = 189.5;
  const rnd = (seed) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };
  for (let i = 58; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(7, 30, 0, 0);
    const k = iso(d), dow = d.getDay(), r = rnd(i);
    if (i % 17 === 9) continue;
    const e = []; let n = 0;
    const add = (id, grams, meal, h) => e.push({ id: `${k}-${n++}`, foodId: id, grams, unit: byId[id].servings[0]?.label || 'g', qty: +(grams / (byId[id].servings[0]?.grams || 1)).toFixed(2), meal, ts: d.getTime() + h * 3600e3 });
    add('oats', 40, 'breakfast', 0); add('blueberries', 74, 'breakfast', 0.1); add('yogurt', 170, 'breakfast', 0.2);
    if (r > 0.4) add('eggs', 100, 'breakfast', 0.3);
    if (i === 0) { add('whey', 31, 'snacks', 3); add('vitd', 1, 'breakfast', 0.4); log[k] = e; continue; }
    add('chicken', 113 + Math.round(r * 40), 'lunch', 5); add('rice', 150, 'lunch', 5.1); add(r > 0.5 ? 'broccoli' : 'spinach', r > 0.5 ? 156 : 85, 'lunch', 5.2); add('olive', 14, 'lunch', 5.3);
    add('almonds', 28, 'snacks', 8); if (r > 0.3) add('banana', 118, 'snacks', 8.2); add('whey', 31, 'snacks', 9);
    if (dow === 5 || dow === 6) { add('pizza', 107 * (r > 0.5 ? 3 : 2), 'dinner', 11.5); }
    else { add(i % 3 ? 'salmon' : 'chicken', 140, 'dinner', 11.5); add('sweetpotato', 150, 'dinner', 11.6); if (r > 0.45) add('avocado', 100, 'dinner', 11.7); }
    if (r > 0.25) add('vitd', 1, 'breakfast', 0.4);
    log[k] = e;
    w -= 0.2 + (dow === 0 ? -0.2 : 0); if (i % 2 === 0) weights[k] = +(w + Math.sin(i) * 0.5).toFixed(1);
    if (dow === 1 || dow === 3 || dow === 5) acts[k] = [{ id: 'a' + i, name: dow === 3 ? 'Strength training' : 'Running', met: dow === 3 ? 5 : 9.8, minutes: dow === 3 ? 45 : 30, kcal: dow === 3 ? 320 : 380, ts: d.getTime() + 3600e3 * 10 }];
  }
  localStorage.setItem('nt.foods', JSON.stringify(Object.fromEntries(foods.map((f) => [f.id, f]))));
  localStorage.setItem('nt.log', JSON.stringify(log));
  localStorage.setItem('nt.weights', JSON.stringify(weights));
  localStorage.setItem('nt.activities', JSON.stringify(acts));
  localStorage.setItem('nt.settings', JSON.stringify({ name: 'Alex', swipeHintSeen: true, targets: { protein: 150, carbs: 200, fat: 65 }, profile: { sex: 'male', age: 34, heightIn: 70, activity: 'light', goal: 'lose', rateLb: 1, autoTarget: true } }));
})();
