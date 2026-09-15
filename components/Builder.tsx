"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { DEFAULT_SETTINGS, MIGRATED_FEE_OPTIONS, PRESETS, type FeeCurve, type LaunchSettings, type MigratedFeeBps } from "@/lib/settings";
import { STOCKS } from "@/lib/stocks";
import type { LaunchPreview } from "@/lib/server/launch";
import type { StockInfo } from "@/lib/server/stockInfo";
import { amount, bps, duration, pct, short, tiny, usd } from "@/lib/format";
import { waitForConfirmation } from "@/lib/client/confirm";
import { CurveChart, FeeChart } from "./Charts";
import WalletButton from "./WalletButton";

type TokenForm = { name: string; symbol: string; description: string; image: string; website: string; x: string; customUri: string };
type Step = "idle" | "metadata" | "build" | "sign" | "confirm" | "done";

const STEP_LABEL: Record<Exclude<Step, "idle">, string> = {
  metadata: "Saving token metadata",
  build: "Building and simulating the transaction",
  sign: "Waiting for your wallet",
  confirm: "Confirming on Solana",
  done: "Pool created",
};

export default function Builder() {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [s, setS] = useState<LaunchSettings>(DEFAULT_SETTINGS);
  const [presetId, setPresetId] = useState<string | null>(PRESETS[0].id);
  const [token, setToken] = useState<TokenForm>({ name: "", symbol: "", description: "", image: "", website: "", x: "", customUri: "" });
  const [advanced, setAdvanced] = useState(false);
  const [stocks, setStocks] = useState<StockInfo[]>([]);
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const seq = useRef(0);

  const set = <K extends keyof LaunchSettings>(k: K, v: LaunchSettings[K]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    if (["feeCurve", "startFeeBps", "endFeeBps", "openingMinutes", "dynamicFee", "lpSupplyPct"].includes(k)) setPresetId(null);
  };

  useEffect(() => {
    fetch("/api/stocks").then((r) => r.json()).then((j) => j.stocks && setStocks(j.stocks)).catch(() => {});
  }, []);

  // Debounced live preview from the server (the SDK maths runs there).
  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      fetch("/api/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) })
        .then((r) => r.json())
        .then((j) => { if (id === seq.current) setPreview(j); })
        .catch(() => {})
        .finally(() => { if (id === seq.current) setLoading(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [s]);

  const stock = preview?.stock ?? stocks.find((x) => x.mint === s.stockMint) ?? null;
  const meta = STOCKS.find((x) => x.mint === s.stockMint)!;
  const busy = step !== "idle" && step !== "done";
  const tokenProblems = useMemo(() => {
    const out: string[] = [];
    if (!token.name.trim()) out.push("Give the token a name.");
    if (!/^[A-Za-z0-9]{2,10}$/.test(token.symbol.trim())) out.push("Ticker must be 2 to 10 letters or digits.");
    if (token.image && !/^https:\/\//.test(token.image)) out.push("Image must be an https link.");
    if (token.customUri && !/^https:\/\//.test(token.customUri)) out.push("Metadata link must be https.");
    return out;
  }, [token]);
  const warnings = useMemo(() => {
    const w: string[] = [];
    if (stock?.permanentDelegate) w.push(`The ${stock.symbol} issuer holds a permanent delegate: it can move ${stock.symbol} out of any account, including this pool's reserve.`);
    if (stock?.nextMultiplierAt) w.push(`${stock.symbol} has a corporate action scheduled (multiplier ${stock.multiplier} → ${stock.nextMultiplier}). USD values shift when it applies.`);
    return w;
  }, [stock]);
  const canLaunch = !!preview?.ok && tokenProblems.length === 0 && connected && !!signTransaction && !busy && (warnings.length === 0 || ack);

  async function launch() {
    if (!publicKey || !signTransaction || !preview?.ok) return;
    setError(null);
    setErrorLogs([]);
    try {
      let uri = token.customUri.trim();
      if (!uri) {
        setStep("metadata");
        const m = await fetch("/api/metadata", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: token.name, symbol: token.symbol, description: token.description, image: token.image, website: token.website, x: token.x, stock: meta.symbol }),
        }).then((r) => r.json());
        if (m.error) throw new Error(m.error);
        uri = m.uri;
      }

      setStep("build");
      const config = Keypair.generate();
      const baseMint = Keypair.generate();
      const b = await fetch("/api/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: s, wallet: publicKey.toBase58(), config: config.publicKey.toBase58(), baseMint: baseMint.publicKey.toBase58(), name: token.name, symbol: token.symbol, uri }),
      }).then((r) => r.json());
      if (b.error) throw new Error(b.error);
      if (!b.simulation.ok) {
        setErrorLogs(b.simulation.logs ?? []);
        throw new Error(`Simulation failed: ${b.simulation.error}`);
      }

      setStep("sign");
      const vtx = VersionedTransaction.deserialize(Uint8Array.from(atob(b.tx), (ch) => ch.charCodeAt(0)));
      vtx.sign([config, baseMint]);
      const signed = await signTransaction(vtx);
      const raw = signed.serialize();

      setStep("confirm");
      const sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      await waitForConfirmation(connection, sig, b.lastValidBlockHeight, raw);

      setStep("done");
      // Put the pool in the index now (it would otherwise wait for the next scan). Do not block on it.
      await Promise.race([
        fetch("/api/pools/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pool: b.pool }) }).catch(() => null),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      router.push(`/pool/${b.pool}?launched=${sig}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|cancel/i.test(msg) ? "Cancelled in the wallet. Nothing was sent." : msg);
      setStep("idle");
    }
  }

  const c = preview?.curve;
  const f = preview?.fees;
  const up = preview?.usdPerStock ?? null;

  return (
    <div className="builder">
      <div className="stack" style={{ gap: 22 }}>
        {/* 1 stock */}
        <section className="panel panel-pad section">
          <div className="section-head"><span className="n">01</span><h2>Quote stock</h2></div>
          <p className="small muted" style={{ margin: 0 }}>Buyers pay in this stock, fees accrue in it, and the curve&apos;s reserve is held in it until graduation.</p>
          <div className="stockpick" role="group" aria-label="Quote stock">
            {STOCKS.map((x) => {
              const info = stocks.find((i) => i.mint === x.mint);
              return (
                <button key={x.mint} type="button" className="stockbtn" aria-pressed={s.stockMint === x.mint} onClick={() => set("stockMint", x.mint)}>
                  <b>{x.symbol}</b>
                  <span>{info?.usd ? usd(info.usd) : x.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2 token */}
        <section className="panel panel-pad section">
          <div className="section-head"><span className="n">02</span><h2>Token</h2></div>
          <div className="row2">
            <div className="field">
              <label htmlFor="t-name">Name</label>
              <input id="t-name" className="input" maxLength={32} value={token.name} onChange={(e) => setToken({ ...token, name: e.target.value })} placeholder="Chip Index Club" />
            </div>
            <div className="field">
              <label htmlFor="t-sym">Ticker</label>
              <input id="t-sym" className="input mono" maxLength={10} value={token.symbol} onChange={(e) => setToken({ ...token, symbol: e.target.value.toUpperCase() })} placeholder="CHIPS" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="t-desc">Description</label>
            <textarea id="t-desc" className="textarea" maxLength={500} value={token.description} onChange={(e) => setToken({ ...token, description: e.target.value })} placeholder="What holders get, and why it is priced in the stock." />
          </div>
          <div className="row3">
            <div className="field">
              <label htmlFor="t-img">Image link</label>
              <input id="t-img" className="input" value={token.image} onChange={(e) => setToken({ ...token, image: e.target.value })} placeholder="https://…" />
            </div>
            <div className="field">
              <label htmlFor="t-web">Website</label>
              <input id="t-web" className="input" value={token.website} onChange={(e) => setToken({ ...token, website: e.target.value })} placeholder="https://…" />
            </div>
            <div className="field">
              <label htmlFor="t-x">X handle</label>
              <input id="t-x" className="input" value={token.x} onChange={(e) => setToken({ ...token, x: e.target.value })} placeholder="@handle" />
            </div>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>Metadata is immutable once the pool exists. Name, ticker and links cannot be changed later.</p>
        </section>

        {/* 3 opening */}
        <section className="panel panel-pad section">
          <div className="section-head"><span className="n">03</span><h2>Opening and fees</h2></div>
          <div className="presets" role="group" aria-label="Fee presets">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className="preset" aria-pressed={presetId === p.id} onClick={() => { setS((prev) => ({ ...prev, ...p.patch })); setPresetId(p.id); }}>
                <strong>{p.name}</strong>
                <span>{p.blurb}</span>
              </button>
            ))}
          </div>
          <div className="field">
            <span className="label">Fee schedule</span>
            <div className="seg" role="group" aria-label="Fee schedule">
              {(["exponential", "linear", "flat"] as FeeCurve[]).map((m) => (
                <button key={m} type="button" aria-pressed={s.feeCurve === m} onClick={() => set("feeCurve", m)}>
                  {m === "exponential" ? "Exponential decay" : m === "linear" ? "Linear decay" : "Flat"}
                </button>
              ))}
            </div>
          </div>
          <div className="row3">
            {s.feeCurve !== "flat" && (
              <div className="field">
                <label htmlFor="f-start">Opening fee</label>
                <div className="input-affix"><input id="f-start" className="input mono" type="number" min={0.25} max={99} step={0.25} value={s.startFeeBps / 100} onChange={(e) => set("startFeeBps", Math.round(Number(e.target.value) * 100))} /><span>%</span></div>
              </div>
            )}
            <div className="field">
              <label htmlFor="f-end">{s.feeCurve === "flat" ? "Fee" : "Steady fee"}</label>
              <div className="input-affix"><input id="f-end" className="input mono" type="number" min={0.25} max={99} step={0.05} value={s.endFeeBps / 100} onChange={(e) => { const v = Math.round(Number(e.target.value) * 100); set("endFeeBps", v); if (s.feeCurve === "flat") set("startFeeBps", v); }} /><span>%</span></div>
            </div>
            {s.feeCurve !== "flat" && (
              <div className="field">
                <label htmlFor="f-min">Opening window</label>
                <div className="input-affix"><input id="f-min" className="input mono" type="number" min={1} max={1440} value={s.openingMinutes} onChange={(e) => set("openingMinutes", Number(e.target.value))} /><span>min</span></div>
              </div>
            )}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={s.dynamicFee} onChange={(e) => set("dynamicFee", e.target.checked)} />
            <span>Volatility fee on top <span className="muted small">(rises when price moves fast, like a circuit breaker)</span></span>
          </label>
        </section>

        {/* 4 graduation */}
        <section className="panel panel-pad section">
          <div className="section-head"><span className="n">04</span><h2>Graduation</h2></div>
          <div className="field">
            <label htmlFor="g-usd">Raise to graduate</label>
            <div className="input-affix"><input id="g-usd" className="input mono" type="number" min={750} step={250} value={s.graduationUsd} onChange={(e) => set("graduationUsd", Number(e.target.value))} /><span>USD</span></div>
            <span className="hint">
              Converted to {meta.symbol} at the live price when you launch
              {preview?.curve ? <> = <span className="mono">{amount(preview.curve.graduationRaise, 4)} {meta.symbol}</span></> : null}. Meteora&apos;s keeper needs at least $750 to migrate a stock pair.
            </span>
          </div>
          <div className="field">
            <label htmlFor="g-lp">Supply paired into the DAMM v2 pool at graduation: <span className="mono">{s.lpSupplyPct}%</span></label>
            <input id="g-lp" type="range" min={5} max={60} value={s.lpSupplyPct} onChange={(e) => set("lpSupplyPct", Number(e.target.value))} />
            <span className="hint">The rest ({100 - s.lpSupplyPct}%) is sold along the curve. More paired supply means a deeper pool after graduation and a steeper curve before it.</span>
          </div>
          <button type="button" className="btn btn-ghost" style={{ justifySelf: "start", paddingLeft: 0 }} onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
            {advanced ? "▾" : "▸"} Advanced: liquidity lock, fee split, supply
          </button>
          {advanced && (
            <div className="stack-sm">
              <div className="row2">
                <div className="field">
                  <label htmlFor="a-lock-p">Your LP, permanently locked</label>
                  <div className="input-affix"><input id="a-lock-p" className="input mono" type="number" min={0} max={100} value={s.partnerLockedPct} onChange={(e) => set("partnerLockedPct", Number(e.target.value))} /><span>%</span></div>
                </div>
                <div className="field">
                  <label htmlFor="a-free-p">Your LP, claimable</label>
                  <div className="input-affix"><input id="a-free-p" className="input mono" type="number" min={0} max={100} value={s.partnerUnlockedPct} onChange={(e) => set("partnerUnlockedPct", Number(e.target.value))} /><span>%</span></div>
                </div>
                <div className="field">
                  <label htmlFor="a-lock-c">Creator LP, permanently locked</label>
                  <div className="input-affix"><input id="a-lock-c" className="input mono" type="number" min={0} max={100} value={s.creatorLockedPct} onChange={(e) => set("creatorLockedPct", Number(e.target.value))} /><span>%</span></div>
                </div>
                <div className="field">
                  <label htmlFor="a-free-c">Creator LP, claimable</label>
                  <div className="input-affix"><input id="a-free-c" className="input mono" type="number" min={0} max={100} value={s.creatorUnlockedPct} onChange={(e) => set("creatorUnlockedPct", Number(e.target.value))} /><span>%</span></div>
                </div>
              </div>
              <div className="row3">
                <div className="field">
                  <label htmlFor="a-share">Creator share of fees</label>
                  <div className="input-affix"><input id="a-share" className="input mono" type="number" min={0} max={100} value={s.creatorFeeShare} onChange={(e) => set("creatorFeeShare", Number(e.target.value))} /><span>%</span></div>
                </div>
                <div className="field">
                  <label htmlFor="a-mig">Pool fee after graduation</label>
                  <select id="a-mig" className="select" value={s.migratedFeeBps} onChange={(e) => set("migratedFeeBps", Number(e.target.value) as MigratedFeeBps)}>
                    {MIGRATED_FEE_OPTIONS.map((o) => <option key={o} value={o}>{bps(o)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="a-supply">Total supply</label>
                  <input id="a-supply" className="input mono" type="number" min={1_000_000} step={1_000_000} value={s.totalSupply} onChange={(e) => set("totalSupply", Number(e.target.value))} />
                </div>
              </div>
              <p className="tiny muted" style={{ margin: 0 }}>You launch as both partner (config owner, fee claimer) and creator, so both shares go to your wallet unless you later hand the creator role to someone else.</p>
              <div className="field">
                <label htmlFor="a-uri">Use my own metadata link instead <span className="muted">(optional)</span></label>
                <input id="a-uri" className="input" value={token.customUri} onChange={(e) => setToken({ ...token, customUri: e.target.value })} maxLength={80} placeholder="https://… (JSON with name, symbol, image; 80 chars max)" />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* preview */}
      <aside className="builder-aside stack">
        <div className="panel panel-pad stack" style={{ opacity: loading && !preview ? 0.6 : 1 }}>
          <div className="spread">
            <div>
              <div className="eyebrow">Preview</div>
              <div style={{ fontWeight: 620, fontSize: 17 }}>{token.symbol || "TOKEN"} / {meta.symbol}</div>
            </div>
            <div className="hstack" style={{ gap: 6 }}>
              {stock?.usd ? <span className="chip mono">{meta.symbol} {usd(stock.usd)}</span> : null}
              {loading && <span className="chip">updating…</span>}
            </div>
          </div>

          {c && up ? (
            <>
              <div className="stats">
                <div className="stat"><div className="k">Opening market cap</div><div className="v">{usd(preview!.startFdvUsd, { compact: true })}</div><div className="s">{tiny(c.startPrice)} {meta.symbol}/token</div></div>
                <div className="stat"><div className="k">Graduation market cap</div><div className="v">{usd(preview!.graduationFdvUsd, { compact: true })}</div><div className="s">{(c.graduationPrice / c.startPrice).toFixed(1)}× the opening price</div></div>
                <div className="stat"><div className="k">Raise to graduate</div><div className="v">{usd(c.graduationRaise * up, { compact: true })}</div><div className="s">{amount(c.graduationRaise, 4)} {meta.symbol}</div></div>
                <div className="stat"><div className="k">Sold on curve</div><div className="v">{pct((c.soldOnCurve / c.totalSupply) * 100, 0)}</div><div className="s">{amount(c.lpTokens)} tokens to LP</div></div>
              </div>
              <CurveChart points={c.points} supply={c.totalSupply} usdPerStock={up} stockSymbol={meta.symbol} />
            </>
          ) : (
            <div className="skeleton" style={{ height: 260 }} />
          )}

          {f && (
            <div className="stack-sm">
              <div className="spread">
                <span className="small" style={{ fontWeight: 600 }}>Base fee</span>
                <span className="small mono">{f.durationSec ? `${bps(f.startBps)} → ${bps(f.endBps)} over ${duration(f.durationSec)}` : `${bps(f.endBps)} flat`}{f.dynamic ? " + volatility" : ""}</span>
              </div>
              {f.durationSec > 0 && <FeeChart points={f.points} />}
              <dl className="kv">
                <dt>Meteora protocol</dt><dd>{pct(f.protocolPct, 0)} of fees</dd>
                <dt>You (partner)</dt><dd>{pct(f.partnerPct, 0)}</dd>
                <dt>Creator</dt><dd>{pct(f.creatorPct, 0)}</dd>
                <dt>Paid in</dt><dd>{meta.symbol}</dd>
                <dt>LP locked at graduation</dt><dd>{pct(s.partnerLockedPct + s.creatorLockedPct, 0)}</dd>
              </dl>
            </div>
          )}

          {stock && (
            <div className="stack-sm">
              <div className="small" style={{ fontWeight: 600 }}>{stock.symbol} issuer controls</div>
              <div className="hstack" style={{ gap: 6 }}>
                <span className={`chip ${stock.badge ? "chip-ok" : "chip-bad"}`}>{stock.badge ? "DBC badge ✓" : "No DBC badge"}</span>
                <span className={`chip ${stock.paused ? "chip-bad" : "chip-ok"}`}>{stock.paused ? "Transfers paused" : "Transfers live"}</span>
                {stock.permanentDelegate && <span className="chip chip-warn" title={stock.permanentDelegate}>Permanent delegate</span>}
                <span className="chip mono" title="Scaled UI amount multiplier, updated on corporate actions">×{stock.multiplier.toFixed(4)}</span>
              </div>
            </div>
          )}

          {!!preview?.problems.length && (
            <div className="note note-bad"><strong>Fix before launching</strong><ul>{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
          )}
          {tokenProblems.length > 0 && preview?.ok && (
            <div className="note"><ul style={{ margin: 0 }}>{tokenProblems.map((p) => <li key={p}>{p}</li>)}</ul></div>
          )}
          {warnings.length > 0 && (
            <label className="note note-warn" style={{ display: "grid", gap: 6, cursor: "pointer" }}>
              {warnings.map((w) => <span key={w}>{w}</span>)}
              <span className="toggle"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand</span>
            </label>
          )}

          {!connected ? (
            <WalletButton block />
          ) : (
            <button type="button" className="btn btn-accent btn-lg btn-block" disabled={!canLaunch} onClick={launch}>
              {busy ? STEP_LABEL[step as Exclude<Step, "idle">] + "…" : `Create pool quoted in ${meta.symbol}`}
            </button>
          )}
          {busy && (
            <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
              {(["metadata", "build", "sign", "confirm"] as const).filter((k) => k !== "metadata" || !token.customUri).map((k) => {
                const order = ["metadata", "build", "sign", "confirm", "done"];
                const state = order.indexOf(k) < order.indexOf(step) ? "✓" : k === step ? "…" : "";
                return <li key={k} className={k === step ? "" : "muted"}>{STEP_LABEL[k]} {state}</li>;
              })}
            </ol>
          )}
          {error && (
            <div className="note note-bad">
              {error}
              {errorLogs.length > 0 && <pre className="mono tiny" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{errorLogs.join("\n")}</pre>}
            </div>
          )}
          <p className="tiny muted" style={{ margin: 0 }}>
            One transaction creates the config and the pool{publicKey ? <> from <span className="mono">{short(publicKey.toBase58())}</span></> : null}. Costs about 0.04 SOL in rent and fees. It is simulated before your wallet opens. <Link href="/how-it-works">How the config works</Link>
          </p>
        </div>
      </aside>
    </div>
  );
}
