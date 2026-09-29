#!/usr/bin/env node
// MCP-сервер «Зарплата РФ»: на руки и обратно, НДФЛ 13–22 %, взносы работодателя, отпускные, больничные, компенсация отпуска.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as c from './calc.js';

const server = new McpServer({ name: 'ru-payroll', version: '1.0.0' }, {
  instructions: 'Зарплатные расчёты по законодательству РФ 2025–2026 годов, локально и без токенов. ' +
    '«Сколько получу на руки» и «сколько стоит сотрудник» — salary_calc; «какой оклад поставить, чтобы на руки было X» — salary_from_net; ' +
    'налог с годового дохода — ndfl_calc; отпускные — vacation_pay; компенсация при увольнении — unused_vacation_compensation; ' +
    'больничный — sick_leave_pay; действующие МРОТ, базы и ставки — payroll_params. НДФЛ считается нарастающим итогом с начала года, ' +
    'поэтому при высоких доходах сумма на руки в конце года меньше. Результаты справочные: итог в учётной программе может отличаться на копейки из-за округлений. ' +
    'Russian payroll: net/gross salary, progressive income tax, employer contributions, vacation and sick pay.',
});

const ok = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = e => ({ isError: true, content: [{ type: 'text', text: 'Ошибка: ' + (e?.message || String(e)) }] });
const safe = fn => async args => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };
const calc = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const r2 = x => Math.round(x * 100) / 100;

const Year = z.number().int().refine(y => c.PARAMS[y], 'Поддерживаются 2025 и 2026 годы').default(new Date().getFullYear() >= 2026 ? 2026 : 2025)
  .describe('Расчётный год: 2025 или 2026 (по умолчанию текущий)');
const Tariff = z.enum(['standard', 'msp', 'msp_manufacturing', 'it']).default('standard').describe(
  'Тариф взносов: standard — общий (30 % до предельной базы, 15,1 % сверх); msp — МСП из перечня отраслей Правительства (15 % с части свыше 1,5 МРОТ); ' +
  'msp_manufacturing — МСП обрабатывающих производств (7,6 % свыше 1,5 МРОТ); it — аккредитованные IT-компании (7,6 %)');
const Accident = z.number().min(0.2).max(8.5).default(0.2).describe('Тариф взносов на травматизм, % (0,2 для офисной работы; зависит от класса риска)');

server.registerTool('salary_calc', {
  title: 'Зарплата на руки и стоимость сотрудника',
  description: 'Считает по окладу (зарплате до вычета налога) помесячно за год: НДФЛ по прогрессивной шкале 13–22 % нарастающим итогом, сумму на руки, ' +
    'страховые взносы работодателя и полную стоимость сотрудника; можно добавить разовую премию в конкретный месяц. ' +
    'Возвращает first_month (на руки в первом месяце), rows по месяцам (видно, когда растёт ставка НДФЛ и когда взносы падают после предельной базы) и totals за год. ' +
    'Обратная задача — salary_from_net. Вычеты на детей не учитываются. Только вычисление, без сети.',
  inputSchema: {
    gross: z.number().positive().describe('Начисленная зарплата в месяц до НДФЛ, ₽ (оклад плюс постоянные надбавки)'),
    year: Year, tariff: Tariff, accident_pct: Accident,
    months: z.number().int().min(1).max(12).default(12).describe('Сколько месяцев считать с января'),
    bonus: z.number().min(0).optional().describe('Разовая премия, ₽'),
    bonus_month: z.number().int().min(1).max(12).optional().describe('Месяц выплаты премии 1–12 (по умолчанию декабрь)'),
  },
  annotations: calc,
}, safe(({ gross, year, tariff, accident_pct, months, bonus, bonus_month }) => {
  const plan = c.yearPlan(gross, year, tariff, accident_pct, months, bonus ? { amount: bonus, month: bonus_month || Math.min(12, months) } : null);
  return { year, tariff, first_month: plan.rows[0], totals: plan.totals, rows: plan.rows };
}));

server.registerTool('salary_from_net', {
  title: 'Оклад по сумме на руки',
  description: 'Находит, какую зарплату начислять, чтобы сотрудник получил на руки нужную сумму, с учётом прогрессивного НДФЛ ' +
    '(если с начала года уже выплачено income_before, расчёт идёт по его ставке). Возвращает gross, ndfl, net, взносы и стоимость сотрудника в этом месяце. ' +
    'Используйте при найме, когда кандидат называет сумму «на руки»; прямой расчёт по окладу — salary_calc. Только вычисление, без сети.',
  inputSchema: {
    net: z.number().positive().describe('Нужная сумма на руки за месяц, ₽'),
    income_before: z.number().min(0).default(0).describe('Доход сотрудника у этого работодателя с начала года до этого месяца, ₽'),
    year: Year, tariff: Tariff, accident_pct: Accident,
  },
  annotations: calc,
}, safe(({ net, income_before, year, tariff, accident_pct }) => {
  const gross = c.grossFromNet(net, income_before);
  const ndfl = c.ndflFor(gross, income_before);
  const contrib = c.employerContributions(gross, income_before, year, tariff, accident_pct);
  return { gross, ndfl, net: r2(gross - ndfl), ndfl_rate_pct: Math.round(c.marginalRate(income_before + gross) * 100), employer_contributions: contrib.total, employer_cost: r2(gross + contrib.total) };
}));

server.registerTool('ndfl_calc', {
  title: 'НДФЛ по прогрессивной шкале',
  description: 'НДФЛ резидента с дохода от работы по шкале 2025–2026 годов: 13 % до 2,4 млн, 15 % до 5 млн, 18 % до 20 млн, 20 % до 50 млн, 22 % сверх (в год). ' +
    'Считает налог с годового дохода с разбивкой по ступеням и эффективной ставкой, либо с отдельной выплаты с учётом дохода с начала года (income_before). ' +
    'Для зарплаты целиком удобнее salary_calc. Не учитывает вычеты и доходы с другой шкалой (дивиденды, вклады, продажа имущества). Только вычисление.',
  inputSchema: {
    income: z.number().min(0).describe('Доход, ₽: годовой или сумма одной выплаты, если задан income_before'),
    income_before: z.number().min(0).optional().describe('Доход с начала года до этой выплаты, ₽ — тогда считается налог только с income'),
  },
  annotations: calc,
}, safe(({ income, income_before }) => {
  const prior = income_before || 0;
  const tax = c.ndflFor(income, prior);
  const steps = [[0, 2.4e6, 13], [2.4e6, 5e6, 15], [5e6, 20e6, 18], [20e6, 50e6, 20], [50e6, Infinity, 22]]
    .map(([from, to, rate]) => ({ from, to: to === Infinity ? null : to, rate_pct: rate, taxed: r2(Math.max(0, Math.min(prior + income, to) - Math.max(prior, from))) }))
    .filter(s => s.taxed > 0).map(s => ({ ...s, tax: r2(s.taxed * s.rate_pct / 100) }));
  return { income, income_before: prior, ndfl: tax, net: r2(income - tax), effective_rate_pct: income ? r2(tax / income * 100) : 0, steps };
}));

const vacInput = {
  earnings_12m: z.number().min(0).describe('Заработок за 12 месяцев до месяца отпуска, ₽: зарплата и премии; без больничных, отпускных и матпомощи'),
  full_months: z.number().int().min(0).max(12).default(12).describe('Сколько месяцев расчётного периода отработано полностью'),
  partial_days: z.number().min(0).default(0).describe('Для неполных месяцев: сумма «29,3 / дней в месяце × отработанные календарные дни» по каждому такому месяцу'),
  days: z.number().int().min(1).max(365).describe('Календарные дни'),
  income_before: z.number().min(0).default(0).describe('Доход с начала года до выплаты — для точной ставки НДФЛ, ₽'),
};

server.registerTool('vacation_pay', {
  title: 'Отпускные',
  description: 'Отпускные по ст. 139 ТК и Положению № 922: средний дневной заработок = заработок за 12 месяцев / (29,3 × полные месяцы + дни неполных месяцев), ' +
    'умноженный на календарные дни отпуска; плюс НДФЛ и сумма на руки. Возвращает average_daily, gross, ndfl, net. Отпускные выплачиваются не позднее чем за 3 дня до отпуска. ' +
    'Для компенсации при увольнении — unused_vacation_compensation. Индексацию окладов в расчётном периоде учтите в earnings_12m сами. Только вычисление.',
  inputSchema: vacInput,
  annotations: calc,
}, safe(({ earnings_12m, full_months, partial_days, days, income_before }) => {
  const a = c.averageDaily(earnings_12m, full_months, partial_days);
  const gross = r2(a.average_daily * days);
  const ndfl = c.ndflFor(gross, income_before);
  return { ...a, vacation_days: days, gross, ndfl, net: r2(gross - ndfl) };
}));

server.registerTool('unused_vacation_compensation', {
  title: 'Компенсация за неиспользованный отпуск',
  description: 'Компенсация при увольнении: сколько дней отпуска положено (28 дней в год пропорционально отработанным месяцам, с округлением месяцев по правилу «больше половины — целый»), ' +
    'если дни не заданы явно, и сумма по среднему дневному заработку, НДФЛ и на руки. Средний заработок считается как в vacation_pay. Только вычисление.',
  inputSchema: {
    ...vacInput,
    days: z.number().min(0).max(365).optional().describe('Неиспользованные дни, если известны; иначе считаются из worked_months'),
    worked_months: z.number().min(0).max(24).optional().describe('Отработано месяцев в текущем рабочем году (для расчёта дней)'),
    annual_days: z.number().int().min(28).max(60).default(28).describe('Положено дней отпуска в год'),
    used_days: z.number().min(0).default(0).describe('Уже использовано дней в этом рабочем году'),
  },
  annotations: calc,
}, safe(({ earnings_12m, full_months, partial_days, days, worked_months, annual_days, used_days, income_before }) => {
  let d = days;
  if (d == null) {
    if (worked_months == null) throw new Error('Передайте days или worked_months');
    const m = Math.floor(worked_months) + (worked_months % 1 > 0.5 ? 1 : 0);
    d = r2(Math.max(0, annual_days / 12 * m - used_days));
  }
  const a = c.averageDaily(earnings_12m, full_months, partial_days);
  const gross = r2(a.average_daily * d);
  const ndfl = c.ndflFor(gross, income_before);
  return { ...a, compensation_days: d, gross, ndfl, net: r2(gross - ndfl) };
}));

server.registerTool('sick_leave_pay', {
  title: 'Больничный',
  description: 'Пособие по временной нетрудоспособности (255-ФЗ): заработок за два предыдущих года (каждый ограничен предельной базой) / 730, но не ниже МРОТ × 24 / 730; ' +
    'процент по страховому стажу (до 5 лет — 60 %, 5–8 — 80 %, 8+ — 100 %); первые 3 дня оплачивает работодатель, остальные — Социальный фонд. ' +
    'Возвращает average_daily, per_day, employer_part, sfr_part, total, НДФЛ и на руки. Больничный по уходу за ребёнком и по беременности считаются иначе — не для них. Только вычисление.',
  inputSchema: {
    year: Year,
    earnings_prev1: z.number().min(0).describe('Заработок за прошлый год, ₽ (для больничного в 2026 — за 2025)'),
    earnings_prev2: z.number().min(0).describe('Заработок за позапрошлый год, ₽ (для 2026 — за 2024)'),
    days: z.number().int().min(1).max(365).describe('Календарные дни болезни'),
    insurance_years: z.number().min(0).describe('Страховой стаж в годах, например 6.5'),
    part_time_ratio: z.number().min(0.1).max(1).default(1).describe('Доля ставки при неполном времени (для минимального пособия)'),
  },
  annotations: calc,
}, safe(a => c.sickLeave(a)));

server.registerTool('payroll_params', {
  title: 'МРОТ, предельные базы и ставки',
  description: 'Справочные параметры для зарплаты за 2025 или 2026 год: МРОТ, предельная база страховых взносов, 1,5 МРОТ для льготы МСП, ' +
    'шкала НДФЛ, тарифы взносов и максимальный средний дневной заработок для больничных. Используйте, чтобы ответить на вопрос о ставках или проверить исходные данные. Только чтение.',
  inputSchema: { year: Year },
  annotations: calc,
}, safe(({ year }) => {
  const p = c.params(year);
  const b1 = c.INSURANCE_BASES[year - 1], b2 = c.INSURANCE_BASES[year - 2];
  return {
    year, mrot: p.mrot, mrot_x1_5: r2(p.mrot * 1.5), insurance_base: p.insurance_base,
    ndfl_scale: [{ up_to: 2400000, rate_pct: 13 }, { up_to: 5000000, rate_pct: 15 }, { up_to: 20000000, rate_pct: 18 }, { up_to: 50000000, rate_pct: 20 }, { up_to: null, rate_pct: 22 }],
    contribution_tariffs_pct: { standard: { within_base: 30, over_base: 15.1 }, msp: { up_to_1_5_mrot: 30, above: 15 }, msp_manufacturing: { up_to_1_5_mrot: 30, above: 7.6 }, it: { within_base: 7.6, over_base: 0 } },
    sick_leave: { max_average_daily: r2((b1 + b2) / 730), min_average_daily: r2(p.mrot * 24 / 730) },
    note: 'Льгота МСП 15 % с 2026 года — только для отраслей из распоряжения Правительства от 27.12.2025 № 4125-р при доле доходов не менее 70 %.',
  };
}));

await server.connect(new StdioServerTransport());
