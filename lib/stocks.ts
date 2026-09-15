// Tokenized stocks usable as a DBC quote token. Client-safe (no SDK imports).
// Every entry was checked on mainnet on 2026-09-15: Token-2022, 8 decimals,
// and a DBC token badge exists (scripts/probe.ts).
export type StockMeta = { symbol: string; name: string; ticker: string; mint: string; decimals: number };

export const STOCKS: StockMeta[] = [
  { symbol: "NVDAx", ticker: "NVDA", name: "NVIDIA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8 },
  { symbol: "SPYx", ticker: "SPY", name: "S&P 500 ETF", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8 },
  { symbol: "AAPLx", ticker: "AAPL", name: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8 },
  { symbol: "TSLAx", ticker: "TSLA", name: "Tesla", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8 },
  { symbol: "MSFTx", ticker: "MSFT", name: "Microsoft", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8 },
  { symbol: "GOOGLx", ticker: "GOOGL", name: "Alphabet", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8 },
  { symbol: "MSTRx", ticker: "MSTR", name: "Strategy", mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8 },
  { symbol: "MCDx", ticker: "MCD", name: "McDonald's", mint: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2", decimals: 8 },
  { symbol: "GLDx", ticker: "GLD", name: "Gold Trust", mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", decimals: 8 },
];

export const STOCK_BY_MINT = new Map(STOCKS.map((s) => [s.mint, s]));
