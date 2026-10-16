import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, LineChart, Line } from 'recharts';
import type { CallingGraphData } from '../shared/calling-data';
import { Empty } from './components';

export default function CallingGraph({ graph }: { graph: CallingGraphData }) {
  const dateLabel = (value: string) => graph.kind === 'line' ? value.split('-').reverse().join('/') : value;
  const axes = <><CartesianGrid vertical={false} strokeDasharray="3 3" />
    <XAxis dataKey="name" type="category" interval={0} angle={-25} textAnchor="end" height={100} tick={{ fontSize: 10 }} tickFormatter={value => { const label = dateLabel(value); return label.length > 26 ? label.slice(0, 25) + '…' : label; }} label={{ value: graph.xAxis, position: 'insideBottom', offset: 0, style: { fontSize: 12 } }} />
    <YAxis type="number" allowDecimals={false} width={60} label={{ value: graph.yAxis, angle: -90, position: 'insideLeft', offset: -12, style: { textAnchor: 'middle', fontSize: 11 } }} />
    <Tooltip labelFormatter={value => dateLabel(String(value))} />
  </>;
  return <section className="panel calling-graph"><h3>{graph.title}</h3><p className="muted small">{graph.note}</p>
    {graph.missingColumn ? <Empty title={`${graph.xAxis} column missing`} text={`Select a calling-data file containing the ${graph.xAxis} column.`} /> : !graph.data.length ? <Empty title="No matching data for this graph" text="The selected records have no recorded values for this graph. Adjust the filters to include more records." /> : <>
      <div className="calling-chart-scroll" tabIndex={0} role="region" aria-label={`${graph.title} chart; scroll horizontally for more labels`}>
        <div className="chart calling-axis-chart" style={{ minWidth: Math.max(460, graph.data.length * 84) }} role="img" aria-label={`${graph.title}. X-axis: ${graph.xAxis}. Y-axis: ${graph.yAxis}. ${graph.data.map(point => dateLabel(point.name) + ': ' + point.count).join('; ')}`}>
          <ResponsiveContainer width="100%" height={360}>{graph.kind === 'line' ? <LineChart data={graph.data} margin={{ top: 16, right: 24, bottom: 16, left: 24 }}>{axes}<Line type="linear" dataKey="count" name={graph.yAxis} stroke="var(--green)" strokeWidth={2} dot={{ r: 4 }} /></LineChart> : <BarChart data={graph.data} margin={{ top: 16, right: 24, bottom: 16, left: 24 }}>{axes}<Bar dataKey="count" name={graph.yAxis} fill="var(--green)" radius={[4, 4, 0, 0]} /></BarChart>}</ResponsiveContainer>
        </div>
      </div>
      <p className="muted small calling-axis-key">X-axis: {graph.xAxis} · Y-axis: {graph.yAxis}</p>
    </>}
  </section>;
}
