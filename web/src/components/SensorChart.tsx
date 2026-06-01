"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
} from "recharts";
import { getReadings } from "@/lib/api";
import { startVisibilityAwarePolling } from "@/lib/poll";
import type { WaterReading } from "@/lib/types";

type MetricKey = "ph" | "ec" | "water_temp" | "orp";

const METRIC_DEFS: Record<
  MetricKey,
  { label: string; unit: string; color: string; band: [number, number] | null; digits: number }
> = {
  ph: { label: "pH", unit: "", color: "#10b981", band: [5.5, 6.5], digits: 2 },
  ec: { label: "EC", unit: "μS/cm", color: "#3b82f6", band: [800, 1200], digits: 0 },
  water_temp: { label: "טמפ' מים", unit: "°C", color: "#f59e0b", band: [18, 24], digits: 1 },
  orp: { label: "ORP", unit: "mV", color: "#8b5cf6", band: [200, 400], digits: 0 },
};

const HOURS_OPTIONS: { hours: number; label: string }[] = [
  { hours: 1, label: "1ש'" },
  { hours: 6, label: "6ש'" },
  { hours: 24, label: "24ש'" },
  { hours: 24 * 7, label: "7י'" },
];

export function SensorChart() {
  const [metric, setMetric] = useState<MetricKey>("ph");
  const [hours, setHours] = useState<number>(24);
  const [readings, setReadings] = useState<WaterReading[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getReadings(hours, hours <= 6 ? 600 : 1500)
      .then((r) => {
        if (!cancelled) setReadings(r.readings);
      })
      .catch(() => {
        if (!cancelled) setReadings([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const stop = startVisibilityAwarePolling(() => {
      getReadings(hours, hours <= 6 ? 600 : 1500)
        .then((r) => {
          if (!cancelled) setReadings(r.readings);
        })
        .catch(() => {});
    }, 30_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [hours]);

  const data = useMemo(() => {
    return readings
      .filter((r) => (r as any)[metric] !== null && (r as any)[metric] !== undefined)
      .map((r) => ({
        t: new Date(r.timestamp).getTime(),
        v: (r as any)[metric] as number,
      }));
  }, [readings, metric]);

  const def = METRIC_DEFS[metric];

  return (
    <section className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="font-semibold">היסטוריית חיישן</h2>
        <div className="flex items-center gap-2 flex-wrap" dir="ltr">
          <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded p-0.5">
            {(Object.keys(METRIC_DEFS) as MetricKey[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  metric === m
                    ? "bg-white dark:bg-zinc-700 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {METRIC_DEFS[m].label}
              </button>
            ))}
          </div>
          <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded p-0.5">
            {HOURS_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                onClick={() => setHours(opt.hours)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  hours === opt.hours
                    ? "bg-white dark:bg-zinc-700 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ width: "100%", height: 280 }} dir="ltr">
        {loading && data.length === 0 ? (
          <div className="h-full grid place-items-center text-zinc-400 text-sm">
            טוען...
          </div>
        ) : data.length < 2 ? (
          <div className="h-full grid place-items-center text-zinc-400 text-sm">
            אין מספיק נתונים בטווח הזמן הזה
          </div>
        ) : (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.18)" />
              {def.band && (
                <ReferenceArea
                  y1={def.band[0]}
                  y2={def.band[1]}
                  fill={def.color}
                  fillOpacity={0.07}
                  ifOverflow="visible"
                />
              )}
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => formatTimeTick(v, hours)}
                tick={{ fontSize: 11, fill: "#888" }}
                stroke="rgba(120,120,120,0.4)"
              />
              <YAxis
                tickFormatter={(v) => v.toFixed(def.digits)}
                tick={{ fontSize: 11, fill: "#888" }}
                stroke="rgba(120,120,120,0.4)"
                width={50}
                domain={["auto", "auto"]}
              />
              <Tooltip
                content={(props) => <ChartTooltip {...props} unit={def.unit} digits={def.digits} />}
              />
              <Line
                type="monotone"
                dataKey="v"
                stroke={def.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {def.band && (
        <p className="text-xs text-zinc-400 mt-2 text-center" dir="ltr">
          Highlighted band: target range {def.band[0]}–{def.band[1]} {def.unit}
        </p>
      )}
    </section>
  );
}

function formatTimeTick(t: number, hours: number): string {
  const d = new Date(t);
  if (hours <= 6) {
    return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  }
  if (hours <= 24) {
    return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("he-IL", { month: "short", day: "numeric" });
}

function ChartTooltip(props: { unit: string; digits: number } & Record<string, unknown>) {
  const { active, payload, unit, digits } = props as {
    active?: boolean;
    payload?: ReadonlyArray<{ payload: { t: number; v: number } }>;
    unit: string;
    digits: number;
  };
  if (!active || !payload || !payload.length) return null;
  const { t, v } = payload[0].payload;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded shadow-sm px-2 py-1 text-xs" dir="ltr">
      <div className="text-zinc-500">{new Date(t).toLocaleString("he-IL")}</div>
      <div className="font-semibold tabular-nums">
        {v.toFixed(digits)} {unit}
      </div>
    </div>
  );
}
