/** A plain SVG column chart. Values are integer fils; labels and tooltips use `format`. */
export function BarChart({
  data,
  format,
  label,
}: {
  data: Array<{ label: string; value: number }>;
  format: (value: number) => string;
  label: string;
}) {
  if (data.length === 0) return null;
  const width = 600;
  const height = 240;
  const pad = 30;
  const base = height - pad;
  const plot = base - pad / 2;
  const peak = Math.max(1, ...data.map((point) => point.value));
  const slot = (width - pad * 2) / data.length;
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <svg className="dash-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {[0, 0.5, 1].map((step) => (
        <line
          key={step}
          className="dash-chart-grid"
          x1={pad}
          x2={width - pad / 2}
          y1={base - plot * step}
          y2={base - plot * step}
        />
      ))}
      {data.map((point, index) => {
        const barHeight = Math.max(1, plot * (point.value / peak));
        const x = pad + index * slot + slot * 0.18;
        return (
          <g key={point.label}>
            <rect
              className="dash-chart-bar"
              x={x}
              y={base - barHeight}
              width={slot * 0.64}
              height={barHeight}
              rx="2"
            >
              <title>{`${point.label}: ${format(point.value)}`}</title>
            </rect>
            {index % labelEvery === 0 ? (
              <text className="dash-chart-label" x={x + slot * 0.32} y={height - 8} textAnchor="middle">
                {point.label.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
