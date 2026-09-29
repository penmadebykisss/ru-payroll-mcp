# ru-payroll-mcp — зарплатный калькулятор РФ для ИИ-агентов

[![penmadebykisss/ru-payroll-mcp MCP server](https://glama.ai/mcp/servers/penmadebykisss/ru-payroll-mcp/badges/score.svg)](https://glama.ai/mcp/servers/penmadebykisss/ru-payroll-mcp)
[![CI](https://github.com/penmadebykisss/ru-payroll-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/penmadebykisss/ru-payroll-mcp/actions/workflows/ci.yml)

MCP-сервер, с которым Claude, Cursor и другие ИИ-ассистенты считают зарплату по правилам **2025–2026 годов**:
сумму на руки и обратно, **НДФЛ по прогрессивной шкале 13–22 %** нарастающим итогом, страховые взносы работодателя
(общий тариф, льготы МСП и IT), полную стоимость сотрудника, отпускные, больничные и компенсацию за неиспользованный отпуск.
Всё считается локально, без токенов и отправки данных.

Спросите ассистента:
- *«Кандидат хочет 150 000 на руки — какой оклад ставить и во сколько он обойдётся компании?»*
- *«Сколько я получу на руки при зарплате 400 000, и с какого месяца налог станет 15 %?»*
- *«Посчитай отпускные: заработок за год 1,2 млн, отпуск 14 дней»*
- *«Больничный 10 дней, стаж 6 лет, заработок 1 млн и 800 тыс. за два прошлых года»*

## Инструменты

| Инструмент | Что делает |
|---|---|
| `salary_calc` | По окладу: НДФЛ, на руки, взносы и стоимость сотрудника помесячно за год, с премией |
| `salary_from_net` | Какой оклад начислить, чтобы на руки была нужная сумма |
| `ndfl_calc` | НДФЛ с годового дохода или с отдельной выплаты, разбивка по ступеням и эффективная ставка |
| `vacation_pay` | Отпускные по среднему дневному заработку (29,3 дня) |
| `unused_vacation_compensation` | Компенсация при увольнении, в том числе расчёт положенных дней |
| `sick_leave_pay` | Больничный: средний заработок с лимитами, % по стажу, доля работодателя и Соцфонда |
| `payroll_params` | МРОТ, предельная база, шкала НДФЛ, тарифы, лимиты больничных на год |

**Параметры 2026 года:** МРОТ 27 093 ₽, предельная база взносов 2 979 000 ₽ (30 % до неё, 15,1 % сверх),
НДФЛ 13 % до 2,4 млн, 15 % до 5 млн, 18 % до 20 млн, 20 % до 50 млн, 22 % сверх; максимальный средний дневной заработок
для больничного — 6 827,40 ₽. Льгота МСП 15 % с части зарплаты свыше 1,5 МРОТ с 2026 года действует только для отраслей
из перечня Правительства.

## Установка

Нужен [Node.js](https://nodejs.org) 18+.

### Claude Desktop

```json
{
  "mcpServers": {
    "ru-payroll": {
      "command": "npx",
      "args": ["-y", "github:penmadebykisss/ru-payroll-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add ru-payroll -- npx -y github:penmadebykisss/ru-payroll-mcp
```

## Ограничения

- Не учитываются стандартные вычеты (на детей и др.), районные коэффициенты и северные надбавки — включайте их в сумму начислений сами.
- Больничный по уходу за ребёнком, декретные и пособия по беременности считаются по другим правилам и здесь не поддерживаются.
- Результаты справочные: в учётной программе итог может отличаться на копейки из-за округлений.

## Проверка

```bash
npm test   # эталонные значения посчитаны вручную по НК РФ, 255-ФЗ и Положению № 922
```

## English

**ru-payroll-mcp** is a Russian payroll calculator for AI assistants (2025–2026 rules): net ↔ gross salary with the
progressive 13–22 % personal income tax applied year-to-date, employer insurance contributions (general, SME and IT
tariffs), total employee cost, vacation pay, sick pay and unused-vacation compensation. Fully local, no API keys.

```bash
npx -y github:penmadebykisss/ru-payroll-mcp
```

## Смотрите также

- [ru-docs-mcp](https://github.com/penmadebykisss/ru-docs-mcp) — счета, акты и QR-оплата в PDF
- [ru-business-mcp](https://github.com/penmadebykisss/ru-business-mcp) — проверка контрагентов, курсы ЦБ, производственный календарь

## Лицензия

MIT
