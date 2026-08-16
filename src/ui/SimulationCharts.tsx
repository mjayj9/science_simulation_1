"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface AnnualComparisonDatum {
  name: string;
  fill: string;
  absoluteKWh: number;
  landKWhM2: number;
  pvKWhM2: number;
}

function formatAnnualBarValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "—";
}

export function AnnualComparisonChart({
  title,
  subtitle,
  unit,
  dataKey,
  data,
  provenance,
}: {
  title: string;
  subtitle: string;
  unit: string;
  dataKey: "absoluteKWh" | "landKWhM2" | "pvKWhM2";
  data: AnnualComparisonDatum[];
  provenance: string;
}) {
  return (
    <section className="surface-card chart-card annual-unit-chart" aria-label={`${title}, 단위 ${unit}`}>
      <div className="panel-header"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
      <div className="chart-medium">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 28, right: 8, bottom: 20, left: 10 }}>
            <CartesianGrid stroke="#203743" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="name" interval={0} angle={-28} textAnchor="end" height={44} tick={{ fontSize: 9 }} minTickGap={0} />
            <YAxis
              width={74}
              label={{ value: unit, angle: -90, position: "insideLeft", fill: "#6f8993", fontSize: 10 }}
              tickFormatter={(value) => Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}
            />
            <Tooltip
              contentStyle={{ background: "#10212c", border: "1px solid #29404c" }}
              formatter={(value) => [`${Number(value).toFixed(3)} ${unit}`, title]}
            />
            <Bar dataKey={dataKey} name={`${title} (${unit})`} radius={[5, 5, 0, 0]} isAnimationActive={false}>
              {data.map((item) => <Cell key={`${dataKey}-${item.name}`} fill={item.fill} />)}
              <LabelList dataKey={dataKey} position="top" fill="#c7d8dd" fontSize={9} formatter={formatAnnualBarValue} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <footer className="chart-provenance"><strong>provenance</strong><span>{provenance}</span></footer>
    </section>
  );
}

export function IvPvChart({
  data,
  mppVoltageV,
}: {
  data: Array<{ voltage: number; current: number; power: number }>;
  mppVoltageV: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid stroke="#203643" strokeDasharray="3 5" />
        <XAxis dataKey="voltage" tickFormatter={(value) => Number(value).toFixed(1)} />
        <YAxis yAxisId="i" tickFormatter={(value) => Number(value).toFixed(1)} />
        <YAxis yAxisId="p" orientation="right" tickFormatter={(value) => Number(value).toFixed(1)} />
        <Tooltip contentStyle={{ background: "#10212c", border: "1px solid #29404c" }} />
        <Line yAxisId="i" type="monotone" dataKey="current" name="전류 A" stroke="#51bdd2" dot={false} strokeWidth={2} />
        <Line yAxisId="p" type="monotone" dataKey="power" name="전력 W" stroke="#f3b94d" dot={false} strokeWidth={2} />
        <ReferenceLine yAxisId="p" x={mppVoltageV} stroke="#42c6a5" strokeDasharray="3 3" label="MPP" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface DiagnosticChartSeries {
  key: string;
  axis: "irradiance" | "power" | "angle" | "factor";
  label: string;
  color: string;
}

export function DailyDiagnosticChart({
  data,
  onClick,
  selectedTime,
  series,
}: {
  data: readonly object[];
  onClick: (state: unknown) => void;
  selectedTime?: string;
  series: DiagnosticChartSeries[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={[...data]} onClick={onClick}>
        <CartesianGrid stroke="#203743" strokeDasharray="3 6" />
        <XAxis dataKey="time" interval={11} />
        <YAxis yAxisId="irradiance" width={48} tickFormatter={(value) => Number(value).toFixed(0)} />
        <YAxis yAxisId="power" orientation="right" width={42} tickFormatter={(value) => Number(value).toFixed(2)} />
        <YAxis yAxisId="angle" hide domain={[-90, 180]} />
        <YAxis yAxisId="factor" hide domain={[0, 1]} />
        <Tooltip
          contentStyle={{ background: "#10212c", border: "1px solid #29404c", borderRadius: 10 }}
          formatter={(value, name) => [Number(value).toFixed(3), name]}
        />
        <Legend />
        {selectedTime ? <ReferenceLine yAxisId="power" x={selectedTime} stroke="#f7d774" strokeDasharray="4 3" /> : null}
        {series.map((descriptor) => (
          <Line
            key={descriptor.key}
            yAxisId={descriptor.axis}
            type="linear"
            dataKey={descriptor.key}
            name={descriptor.label}
            stroke={descriptor.color}
            dot={false}
            activeDot={{ r: 5 }}
            strokeWidth={descriptor.key === "poa" || descriptor.key === "dc" || descriptor.key === "ac" ? 2 : 1.5}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MonthlyEnergyChart({
  data,
}: {
  data: Array<{ month: string; energy: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid stroke="#203743" strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="month" />
        <YAxis tickFormatter={(value) => Number(value).toFixed(0)} />
        <Tooltip
          contentStyle={{ background: "#10212c", border: "1px solid #29404c" }}
          formatter={(value) => [`${Number(value).toFixed(1)} Wh`, "에너지"]}
        />
        <Bar dataKey="energy" radius={[5, 5, 0, 0]}>
          {data.map((_, index) => <Cell key={index} fill={index === 5 ? "#f4ba4b" : "#3d8295"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
