// 웹 전략 가이드(frontend/src/pages/Strategies.tsx)의 글을 앱이 읽는 JSON 으로 옮긴다.
// 손으로 옮기면 웹과 어긋나므로, 웹 글을 고친 뒤에는 이걸 다시 돌린다.
//   node ios/Fixtures/export_strategy_guide.mjs
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../../frontend/src/pages/Strategies.tsx", import.meta.url), "utf8");
const body = src.slice(src.indexOf("const STRATEGY_DETAILS"), src.indexOf("export default function"))
  .replace(/const STRATEGY_DETAILS: Record<[\s\S]*?\}> = /, "const STRATEGY_DETAILS = ")
  .replace(/const CATEGORIES: [^=]+= /, "const CATEGORIES = ");
const theme = readFileSync(new URL("../../frontend/src/theme.ts", import.meta.url), "utf8");
const color = (name) => theme.match(new RegExp(`export const ${name} = "(#[0-9a-fA-F]{6})"`))[1];
const { STRATEGY_DETAILS, CATEGORIES } = new Function("POSITIVE", "NEGATIVE",
  `${body}; return { STRATEGY_DETAILS, CATEGORIES };`)(color("POSITIVE"), color("NEGATIVE"));

const out = { categories: CATEGORIES, details: STRATEGY_DETAILS };
writeFileSync(new URL("../Leaderboard/StrategyGuide.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(CATEGORIES.map((c) => `${c.label}:${c.strategies.length}`).join(" "), "·", Object.keys(STRATEGY_DETAILS).length, "strategies");
