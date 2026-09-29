// Дымовой тест: сервер как MCP-клиент; значения посчитаны вручную по НК РФ, 255-ФЗ и Положению № 922.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/index.js'] }));
const { tools } = await client.listTools();
console.log(`tools (${tools.length}):`, tools.map(t => t.name).join(', '));
let failed = 0;
if (tools.length !== 7) { console.log('FAIL ожидалось 7 инструментов'); failed++; }
async function run(name, args, check) {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text || '';
  let ok;
  try { ok = check(r.isError ? null : JSON.parse(t), t, r.isError); } catch { ok = false; }
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${t.replace(/\s+/g, ' ').slice(0, 200)}`);
}

await run('salary_calc', { gross: 100000, year: 2026 }, d => d.first_month.net === 87000 && d.first_month.employer_cost === 130200 && d.totals.net === 1044000);
await run('salary_calc', { gross: 300000, year: 2026 }, d => d.rows[7].ndfl === 39000 && d.rows[8].ndfl === 45000 && d.rows[8].ndfl_rate_pct === 15
  && d.rows[9].employer_contributions === 87471 && d.rows[10].employer_contributions === 45900);
await run('salary_calc', { gross: 100000, year: 2026, tariff: 'msp' }, d => d.first_month.employer_contributions === 21295.93);
await run('salary_calc', { gross: 100000, year: 2026, months: 3, bonus: 50000, bonus_month: 2 }, d => d.rows[1].gross === 150000 && d.totals.gross === 350000);
await run('salary_from_net', { net: 87000, year: 2026 }, d => d.gross === 100000 && d.net === 87000);
await run('salary_from_net', { net: 255000, income_before: 2400000, year: 2026 }, d => d.gross === 300000 && d.ndfl_rate_pct === 15);
await run('ndfl_calc', { income: 6000000 }, d => d.ndfl === 882000 && d.steps.length === 3 && d.effective_rate_pct === 14.7);
await run('ndfl_calc', { income: 100000, income_before: 2350000 }, d => d.ndfl === 50000 * 0.13 + 50000 * 0.15);
await run('vacation_pay', { earnings_12m: 1200000, days: 14 }, d => d.average_daily === 3412.97 && d.gross === 47781.58 && d.ndfl === 6212);
await run('unused_vacation_compensation', { earnings_12m: 1200000, worked_months: 5.6 }, d => d.compensation_days === 14 && d.gross === 47781.58);
await run('unused_vacation_compensation', { earnings_12m: 1200000 }, (d, t, e) => e && t.includes('worked_months'));
await run('sick_leave_pay', { year: 2026, earnings_prev1: 1000000, earnings_prev2: 800000, days: 10, insurance_years: 6 },
  d => d.average_daily === 2465.75 && d.percent === 80 && d.per_day === 1972.6 && d.employer_part === 5917.8 && d.sfr_days === 7 && d.total === 19726);
await run('sick_leave_pay', { year: 2026, earnings_prev1: 5000000, earnings_prev2: 5000000, days: 5, insurance_years: 10 }, d => d.average_daily === 6827.4 && d.capped_prev1);
await run('sick_leave_pay', { year: 2026, earnings_prev1: 0, earnings_prev2: 0, days: 5, insurance_years: 2 }, d => d.used_minimum_wage && d.average_daily === 890.73 && d.per_day === 534.44);
await run('payroll_params', { year: 2026 }, d => d.mrot === 27093 && d.insurance_base === 2979000 && d.sick_leave.max_average_daily === 6827.4);
await run('payroll_params', { year: 2020 }, (d, t, e) => e);

await client.close();
console.log(failed ? `\nПровалено: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
