// Расчёты по зарплате РФ: НДФЛ по прогрессивной шкале, страховые взносы, отпускные, больничные.
// Все параметры по годам — в PARAMS; источники указаны рядом.

export const PARAMS = {
  2025: {
    mrot: 22440,                  // ФЗ от 29.10.2024 № 365-ФЗ
    insurance_base: 2759000,      // ПП РФ от 22.11.2024 № 1616
  },
  2026: {
    mrot: 27093,                  // ФЗ о МРОТ на 2026 год
    insurance_base: 2979000,      // ПП РФ от 31.10.2025 № 1705
  },
};
// Предельные базы по годам — для расчёта больничных (берутся два предыдущих года)
export const INSURANCE_BASES = { 2023: 1917000, 2024: 2225000, 2025: 2759000, 2026: 2979000 };

// Прогрессивная шкала НДФЛ для доходов резидентов (зарплата), ст. 224 НК РФ, с 2025 года
const NDFL_SCALE = [
  [2_400_000, 0.13], [5_000_000, 0.15], [20_000_000, 0.18], [50_000_000, 0.20], [Infinity, 0.22],
];

const r2 = x => Math.round(x * 100) / 100;
const rub = x => Math.round(x); // НДФЛ исчисляется в полных рублях

export function params(year) {
  const p = PARAMS[year];
  if (!p) throw new Error(`Параметры есть для ${Object.keys(PARAMS).join(', ')} годов`);
  return p;
}

/** НДФЛ нарастающим итогом с начала года (ст. 224 НК): налог с дохода income при уже полученном prior за год. */
export function ndflYear(total) {
  let tax = 0, prev = 0;
  for (const [limit, rate] of NDFL_SCALE) {
    if (total > prev) tax += (Math.min(total, limit) - prev) * rate;
    prev = limit;
  }
  return tax;
}
export function ndflFor(income, priorIncome = 0) {
  return rub(ndflYear(priorIncome + income)) - rub(ndflYear(priorIncome));
}
export function marginalRate(total) {
  for (const [limit, rate] of NDFL_SCALE) if (total <= limit) return rate;
  return 0.22;
}

/**
 * Взносы работодателя за месяц. tariff:
 *  standard — 30% до предельной базы, 15,1% сверх;
 *  msp — МСП из правительственного перечня: 30% с 1,5 МРОТ, 15% с превышения (сверх базы тоже 15%);
 *  msp_manufacturing — МСП обрабатывающих производств: 30% с 1,5 МРОТ, 7,6% с превышения;
 *  it — аккредитованные IT-компании: 7,6% до базы, 0% сверх.
 * accident — тариф на травматизм (0,2–8,5 %), считается со всей суммы.
 */
export function employerContributions(gross, priorYear, year, tariff = 'standard', accidentPct = 0.2) {
  const p = params(year);
  const base = p.insurance_base;
  const within = Math.max(0, Math.min(gross, base - priorYear));
  const over = gross - within;
  let main;
  if (tariff === 'standard') main = within * 0.30 + over * 0.151;
  else if (tariff === 'it') main = within * 0.076;
  else {
    const reduced = tariff === 'msp' ? 0.15 : 0.076;
    const low = Math.min(gross, p.mrot * 1.5);
    main = low * 0.30 + (gross - low) * reduced;
  }
  const accident = gross * accidentPct / 100;
  return { main: r2(main), accident: r2(accident), total: r2(main + accident) };
}

/** Помесячная раскладка года: НДФЛ растёт при переходе порогов, взносы падают после предельной базы. */
export function yearPlan(monthlyGross, year, tariff, accidentPct, months = 12, bonus = null) {
  let priorIncome = 0, priorBase = 0;
  const rows = [];
  for (let m = 1; m <= months; m++) {
    const gross = monthlyGross + (bonus && bonus.month === m ? bonus.amount : 0);
    const ndfl = ndflFor(gross, priorIncome);
    const contrib = employerContributions(gross, priorBase, year, tariff, accidentPct);
    rows.push({ month: m, gross: r2(gross), ndfl, net: r2(gross - ndfl), employer_contributions: contrib.total, employer_cost: r2(gross + contrib.total), ndfl_rate_pct: Math.round(marginalRate(priorIncome + gross) * 100) });
    priorIncome += gross; priorBase += gross;
  }
  const sum = k => r2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, totals: { gross: sum('gross'), ndfl: sum('ndfl'), net: sum('net'), employer_contributions: sum('employer_contributions'), employer_cost: sum('employer_cost') } };
}

/** Оклад, который даёт нужную сумму «на руки» в указанном месяце (бинарный поиск по копейкам). */
export function grossFromNet(net, priorIncome = 0) {
  let lo = net, hi = net * 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (mid - ndflFor(mid, priorIncome) < net) lo = mid; else hi = mid;
  }
  // Подбираем минимальную сумму в копейках, дающую не меньше net
  let g = Math.floor(hi * 100) / 100;
  while (g - ndflFor(g, priorIncome) < net) g = r2(g + 0.01);
  return g;
}

/** Средний дневной заработок для отпускных и компенсации: ст. 139 ТК, ПП РФ № 922 (29,3 дня на полный месяц). */
export function averageDaily(earnings, fullMonths = 12, partialDays = 0) {
  const days = fullMonths * 29.3 + partialDays;
  if (!(days > 0)) throw new Error('Нужен хотя бы один отработанный день в расчётном периоде');
  return { days: r2(days), average_daily: r2(earnings / days) };
}

/** Процент пособия по стажу (ст. 7 255-ФЗ). */
export function sickPercent(years) {
  if (years >= 8) return 100;
  if (years >= 5) return 80;
  return 60;
}

/**
 * Пособие по временной нетрудоспособности (255-ФЗ): заработок двух предыдущих лет с ограничением
 * предельными базами, делённый на 730; не ниже МРОТ×24/730. Первые 3 дня — работодатель, остальное — СФР.
 */
export function sickLeave({ year, earnings_prev1, earnings_prev2, days, insurance_years, part_time_ratio = 1 }) {
  const p = params(year);
  const b1 = INSURANCE_BASES[year - 1], b2 = INSURANCE_BASES[year - 2];
  if (!b1 || !b2) throw new Error(`Нет предельных баз за ${year - 2}–${year - 1} годы`);
  const e1 = Math.min(earnings_prev1, b1), e2 = Math.min(earnings_prev2, b2);
  let avg = (e1 + e2) / 730;
  const minAvg = p.mrot * 24 / 730 * part_time_ratio;
  const maxAvg = (b1 + b2) / 730;
  const usedMin = avg < minAvg;
  if (usedMin) avg = minAvg;
  const pct = sickPercent(insurance_years);
  // При стаже меньше 6 месяцев пособие не выше МРОТ за полный месяц — упрощённо: не выше МРОТ/30 в день
  let perDay = avg * pct / 100;
  const under6m = insurance_years < 0.5;
  if (under6m) perDay = Math.min(perDay, p.mrot / 30);
  perDay = r2(perDay);
  const employerDays = Math.min(3, days), sfrDays = Math.max(0, days - 3);
  const gross = r2(perDay * days);
  const ndfl = rub(gross * 0.13);
  return {
    average_daily: r2(avg), average_daily_max: r2(maxAvg), used_minimum_wage: usedMin, capped_prev1: earnings_prev1 > b1, capped_prev2: earnings_prev2 > b2,
    percent: pct, per_day: perDay, days, employer_days: employerDays, employer_part: r2(perDay * employerDays), sfr_days: sfrDays, sfr_part: r2(perDay * sfrDays),
    total: gross, ndfl_13: ndfl, net: r2(gross - ndfl), under_6_months_rule: under6m || undefined,
  };
}
