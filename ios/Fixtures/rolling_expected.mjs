// 정답 JSON에 롤링 비교 결과를 채운다. 웹이 쓰는 rolling.ts 를 그대로 불러 계산하므로
// Swift 쪽은 웹 화면과 같은 B&H 승률·초과 중앙값을 내야 한다.
//   node ios/Fixtures/rolling_expected.mjs <fixture 폴더>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WINDOW_OPTIONS, rollingVsBenchmark, windowAllowed } from "../../frontend/src/utils/rolling.ts";

const dir = process.argv[2];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const path = join(dir, f);
  const fx = JSON.parse(readFileSync(path, "utf8"));
  for (const c of fx.cases) {
    const results = c.expected.results;
    const bench = results.find((r) => r.strategy_name === "buy_and_hold");
    const points = results[0]?.curve.length ?? 0;
    c.rolling = {};
    for (const { weeks } of WINDOW_OPTIONS) {
      if (!bench || !windowAllowed(weeks, points)) continue;
      c.rolling[weeks] = Object.fromEntries(
        results
          .filter((r) => r.strategy_name !== "buy_and_hold")
          .map((r) => [r.strategy_name, rollingVsBenchmark(r.curve, bench.curve, weeks)])
      );
    }
  }
  writeFileSync(path, JSON.stringify(fx));
  console.log(f, Object.keys(fx.cases[0].rolling).join(","));
}
