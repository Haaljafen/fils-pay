import { useEffect, useState } from "react";
import { simulateFees, type FeeSimulation } from "../../api/simulations.js";
import { describeError } from "../../api/client.js";
import { bhd } from "../../format.js";

/**
 * "What if?" fee simulator. Two sliders change the proposed volume and MDR;
 * the page asks the server to replay the last 90 days of real captures under
 * that scenario. The server does the money maths. Nothing is saved or changed.
 */
export function FeeSimulatorPage() {
  const [volumeChangePct, setVolumeChangePct] = useState(0);
  const [mdrBps, setMdrBps] = useState<number | null>(null);
  const [result, setResult] = useState<FeeSimulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Start from the merchant's real current rate, then follow the sliders.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    simulateFees({
      volumeChangePct,
      mdrBps: mdrBps ?? undefined,
    })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        if (mdrBps === null) setMdrBps(r.currentMdrBps);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // mdrBps is read once for the first load; sliders drive later requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeChangePct, mdrBps]);

  const currentMdr = result?.currentMdrBps ?? 0;
  const change = result?.netChangePerMonthFils ?? 0;
  const better = change > 0;
  const worse = change < 0;

  return (
    <div className="page">
      <h1>What if?</h1>
      <p className="muted">
        See what your payouts would look like under a different volume or fee. This uses your
        last 90 days of real sales. It changes nothing.
      </p>

      <div className="card">
        <label>
          Volume change: <strong>{volumeChangePct >= 0 ? "+" : ""}{volumeChangePct}%</strong>
          <input
            type="range"
            min={-90}
            max={300}
            step={5}
            value={volumeChangePct}
            onChange={(e) => setVolumeChangePct(Number(e.target.value))}
          />
        </label>

        <label>
          Fee (MDR): <strong>{((mdrBps ?? currentMdr) / 100).toFixed(2)}%</strong>
          <input
            type="range"
            min={0}
            max={1000}
            step={5}
            value={mdrBps ?? currentMdr}
            onChange={(e) => setMdrBps(Number(e.target.value))}
          />
          <span className="muted">Today: {(currentMdr / 100).toFixed(2)}%</span>
        </label>
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {loading && !result && <p>Calculating…</p>}

      {result && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th />
                <th>Today</th>
                <th>Scenario</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Payments in last {result.windowDays} days</td>
                <td>{result.current.transactionCount}</td>
                <td>{result.scenario.transactionCount}</td>
              </tr>
              <tr>
                <td>Sales volume</td>
                <td>{bhd(result.current.volumeFils)}</td>
                <td>{bhd(result.scenario.volumeFils)}</td>
              </tr>
              <tr>
                <td>Fees</td>
                <td>{bhd(result.current.feesFils)}</td>
                <td>{bhd(result.scenario.feesFils)}</td>
              </tr>
              <tr>
                <td>You keep (sales minus fees)</td>
                <td>{bhd(result.current.netFils)}</td>
                <td>{bhd(result.scenario.netFils)}</td>
              </tr>
            </tbody>
          </table>

          <p className={better ? "good" : worse ? "bad" : ""}>
            {change === 0 && "No change in what you keep."}
            {better && `About ${bhd(change)} more per month than today.`}
            {worse && `About ${bhd(-change)} less per month than today.`}
          </p>
          <p className="muted">
            Based on the last {result.windowDays} days of captured payments. Refunds not yet
            processed and any change in timing are not included.
          </p>
        </div>
      )}
    </div>
  );
}
