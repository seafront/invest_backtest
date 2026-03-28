import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, ColorType } from "lightweight-charts";
import type { StockData, TradeResult, IndicatorPoint } from "../types";

interface Props {
  data: StockData[];
  trades?: TradeResult[];
  indicators?: Record<string, IndicatorPoint[]> | null;
}

const COLORS = ["#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981"];

export default function CandlestickChart({ data, trades, indicators }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: "#1e1e2e" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      crosshair: { mode: 0 },
      timeScale: { borderColor: "#334155" },
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    candleSeries.setData(
      data.map((d) => ({
        time: d.date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
    );

    // Add indicator lines
    if (indicators) {
      Object.entries(indicators).forEach(([name, points], idx) => {
        const lineSeries = chart.addLineSeries({
          color: COLORS[idx % COLORS.length],
          lineWidth: 1,
          title: name,
        });
        lineSeries.setData(
          points.map((p) => ({ time: p.date, value: p.value }))
        );
      });
    }

    // Add trade markers
    if (trades && trades.length > 0) {
      const markers = trades.map((t) => ({
        time: t.date,
        position: t.action === "BUY" ? "belowBar" as const : "aboveBar" as const,
        color: t.action === "BUY" ? "#22c55e" : "#ef4444",
        shape: t.action === "BUY" ? "arrowUp" as const : "arrowDown" as const,
        text: `${t.action} ${t.shares}`,
      }));
      candleSeries.setMarkers(markers);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data, trades, indicators]);

  return (
    <div style={{ background: "#1e1e2e", borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <h3 style={{ color: "#e2e8f0", marginBottom: 12 }}>Price Chart</h3>
      <div ref={containerRef} />
    </div>
  );
}
