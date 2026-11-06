import type { Project } from './types';

/**
 * Projects, in display order (the first four appear on the homepage).
 * Written from each repository's README, code and committed reports; no figure
 * appears here unless the repository measures it. See CONTENT_GUIDE.md.
 */
export const projects: Project[] = [
  {
    slug: 'world-cup-predictor',
    title: 'World Cup 2026 match predictor',
    summary:
      'A leakage-safe data pipeline and probabilistic match models for the FIFA World Cup, turned into tournament odds by Monte Carlo simulation.',
    technologies: ['Python', 'pandas', 'scikit-learn', 'CatBoost / XGBoost (optional)', 'Parquet', 'pytest'],
    problem:
      'Forecasting a World Cup is mostly a data problem. Results come from several sources with inconsistent team names, and carelessly built features let a match, or other matches played the same day, leak into its own prediction. A single "who wins" classifier also ignores how groups, goal difference and knockout paths shape the result.',
    approach:
      'A reproducible pipeline merges historical international results, recent matches from football-data.org and the 2026 fixtures, normalises team names and de-duplicates by source priority. Rolling form and Elo are computed chronologically, holding back same-day matches until all of them have features, and external ratings are joined strictly as-of the match date. Match models are trained on time-aware splits, calibrated and ensembled, and 100,000 simulated tournaments turn match probabilities into stage and champion probabilities.',
    contributions: [
      'Anti-leakage feature engineering: chronological rolling form, pre-match Elo, and strict as-of joins for FIFA ranking and World Football Elo snapshots.',
      'A model layer with feature-group ablation, gradient-boosted classifiers (CatBoost or XGBoost, falling back to scikit-learn), a Poisson model, calibration and an ensemble.',
      'A tournament simulator that resolves the real knockout pairings before predicting them, and reports champion chances as simulation frequencies rather than certainties.',
      'Backtests on past World Cups against bookmaker odds and Elo-only, form-only and frequency baselines, with paired bootstrap confidence intervals.',
    ],
    results:
      "On the 188 matches from the 2014, 2018 and 2022 World Cups that have bookmaker odds, the model's log loss was 1.005 against 0.966 for the bookmakers' implied probabilities, and the paired bootstrap shows the gap is real. The market is still the stronger forecaster.",
    limitations:
      'The FIFA ranking and external Elo features stay empty until real historical snapshots are added, so ablations that depend on them are not yet meaningful. Champion probabilities are frequencies under the model’s assumptions, not guarantees.',
    githubUrl: 'https://github.com/kenichist/wc_predictor',
  },
  {
    slug: 'folia',
    title: 'Folia, a programmable local notes app',
    summary:
      'A fast native notes app with nested pages, LaTeX math that renders as you type and highlighted code, whose whole window layout is a Lua file.',
    technologies: ['C++17', 'Qt 6 Widgets', 'Lua 5.5', 'SQLite', 'CMake'],
    problem:
      'Notes apps built on a browser engine are heavy, and most cannot be reshaped without forking them. Technical notes also need math and code that render properly, offline, with the data kept on your own disk.',
    approach:
      'Folia uses native Qt Widgets with no browser engine. Every page lives in one local SQLite file, and autosave only reports "Saved" once a change is on disk. The sidebar, toolbar and overlays are described by an embedded Lua layout that reloads live when edited and keeps the last working layout if a new one has an error.',
    contributions: [
      'A built-in TeX math renderer (parser, layout and drawing); inline math shows its source when the caret touches it.',
      'A live-reloading Lua layout language for the window shell, with three shipped layouts and a safe-mode fallback.',
      'Fenced code blocks highlighted in 19 languages, and nested pages with breadcrumbs, reordering and a quick title jump.',
      'Release packaging for macOS, Windows and Linux, built and tested in CI, plus a benchmark harness with recorded runs.',
    ],
    results:
      'Measured on a MacBook Air M1 with a 50,000-page workspace: 375–404 ms from launch to an editable page, about 80 MB of memory and 0.16–0.27% of one CPU core at idle, and about 5 ms of CPU per keystroke.',
    limitations:
      'The idle footprint misses its 60 MB stretch target, the macOS build is not notarized yet, and Windows and Linux are not benchmarked. The measurements cover version 0.1.0; later features were not re-measured.',
    githubUrl: 'https://github.com/kenichist/folia',
    links: [{ label: 'download', href: 'https://github.com/kenichist/folia/releases/latest' }],
  },
  {
    slug: 'skyblock-market-forecaster',
    title: 'SkyBlock market forecaster',
    summary:
      "Time-series forecasting and live deal scanning for Hypixel SkyBlock's player-run markets, shown in a dashboard for manual decisions.",
    technologies: ['Python', 'TimesFM 2.5', 'pandas', 'Streamlit', 'Parquet', 'Java (Fabric mod)'],
    problem:
      'Hypixel SkyBlock has a player-driven Bazaar and auction house with thousands of items whose prices move with supply, in-game events and occasional manipulation. Finding real opportunities means reading noisy price histories and comparing listings whose value depends on details hidden in each item.',
    approach:
      "Price histories from the Coflnet API are resampled and forecast with Google's TimesFM 2.5 time-series foundation model, then checked with walk-forward backtests. Momentum and order-book spread are kept as separate signals, the latter after fee, slippage, volume and volatility filters. For auctions, a scanner compares each Buy-It-Now listing with comparable live listings and completed sales.",
    contributions: [
      'Bazaar forecasting and walk-forward backtesting with TimesFM 2.5, ranking items by liquidity, spread, volatility and forecast change.',
      'A metadata-aware auction comparator (reforges, enchantments, gemstones, upgrade levels and more, parsed from item NBT) with anti-manipulation pricing: outlier removal on completed sales and lower-quartile pricing for live listings.',
      'A parallel background scanner that keeps a precomputed candidate cache, served to a Streamlit dashboard and a local API.',
      'An optional Fabric client mod that posts new candidates in chat with a clickable button. It never buys, bids or clicks anything itself.',
    ],
    limitations:
      "Forecasts are not guaranteed profit, and the backtests are simplified: they don't yet fully account for fees, fill risk, latency or manipulation. The current mayor is used only as context, because historical mayor periods aren't collected yet. Every trade stays manual.",
  },
  {
    slug: 'topic-feed',
    title: 'Topic Feed and an adaptive-bot benchmark',
    summary:
      'A browser extension that classifies short videos by topic on-device, its research dashboard, and a benchmark of adaptive bots for testing bot detectors.',
    technologies: ['JavaScript (browser extension)', 'transformers.js / ONNX Runtime', 'MobileCLIP', 'React', 'TypeScript', 'Firebase', 'Python', 'DuckDB', 'scikit-learn'],
    problem:
      'Studying how people and automated accounts behave on short-video feeds needs two things: tooling that records real feed sessions with consent and minimal data, and bots realistic enough that a detector is tested against something harder than fixed timers.',
    approach:
      'For each video on TikTok or Instagram Reels, the extension takes a few frames and the caption and decides on the device whether it matches a chosen topic, using MobileCLIP and a caption matcher. Off-topic videos are skipped. A like, follow, save or comment is only ever offered as a button the user must click. Opt-in, minimised session telemetry feeds a Firebase dashboard. Separately, a research pipeline builds human sessions from the KuaiRec dataset, and a simulator generates bots that are re-tuned against baseline detectors over adversarial rounds.',
    contributions: [
      'On-device video classification in the browser: MobileCLIP (falling back to CLIP) through transformers.js on ONNX Runtime WebAssembly, with local language detection. Frames and page URLs never leave the device.',
      'A companion dashboard (React, Vite, Cloud Functions) with session history, failure diagnostics, consent, export and deletion, an audited admin area, and WCAG AA contrast checks.',
      'A data pipeline that sessionises the 17-million-event KuaiRec corpus out-of-core with DuckDB, with identity-grouped splits and leakage reports.',
      'An adaptive-bot simulator (five families, from fixed timing to persistent personas) and a (1+λ) evolution-strategy loop that re-tunes the bots against logistic-regression and gradient-boosting detectors held at a 1% false-positive rate.',
    ],
    limitations:
      'The human traces come from Kuaishou (KuaiRec), not TikTok. The bots are simulations rather than observed malicious accounts, and the client-integrity columns are synthetic for both classes, so the benchmark alone cannot establish real-world human-vs-bot accuracy.',
  },
];
