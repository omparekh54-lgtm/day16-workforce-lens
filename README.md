# Day 16 — Workforce Lens

**Staffing Capacity & Coverage Lab**

Workforce Lens turns operational workforce history into a forward coverage plan. It forecasts team-level demand, translates uncertainty into required hours, identifies shortages/excess capacity, and recommends cross-team hour reallocation before additional capacity is added.

## Why this is not just another workforce dashboard

Most workforce dashboards describe attendance or historical utilization. Workforce Lens is deliberately forward-looking and decision-oriented: **where is the schedule likely to break, how uncertain is that estimate, and can excess capacity elsewhere cover the gap?**

It also deliberately avoids individual employee scoring. Employee IDs are only used to measure team-level workload concentration; the product does not rank workers, diagnose burnout, or recommend hiring/firing actions.

## Core workflow

1. Upload a CSV with workforce history.
2. Validate data readiness and structural errors.
3. Learn weekday demand patterns, recent demand trend, observed team productivity, and recent capacity.
4. Bootstrap historical residuals to simulate future demand uncertainty.
5. Convert a selected service-protection quantile into required staffing hours using a target utilization guardrail.
6. Identify shortage / balanced / excess team-days.
7. Reallocate excess team-hours to shortage teams before recommending added capacity.
8. Export the operational action plan.

## Input contract

Required columns:

- `date` — ISO date (`YYYY-MM-DD`)
- `team`
- `employee_id`
- `scheduled_hours`
- `productive_hours`
- `absence_hours`
- `demand_units`

Optional: `role`.

## Methodology

For each team:

- aggregate row-level history to team-day level;
- estimate a weekday demand baseline;
- estimate a linear recent trend;
- compute historical residuals;
- generate 400 seeded bootstrap demand simulations per future date;
- select p50/p80/p90 demand according to the user-selected service-protection level;
- estimate observed units/hour from historical demand ÷ productive hours;
- convert protected demand to required hours and divide by target utilization;
- compare with recent mean capacity (`scheduled_hours - absence_hours`).

Cross-team actions are a transparent heuristic: same-day excess hours are reallocated to same-day shortages first, then remaining shortage becomes `ADD_CAPACITY`.

## Confidence & honesty layer

- **Known:** schedules, absence, productive hours, observed demand.
- **Statistical estimate:** weekday/trend demand forecast and bootstrap uncertainty.
- **Heuristic:** reallocation/action ordering.
- **Not claimed:** employee performance, burnout diagnosis, employee suitability, hiring/firing decisions, or guaranteed future service levels.

## Privacy

The application processes uploaded CSV data in the browser. It has no application database and does not require HRIS connectivity.

## Limitations

- Reallocation assumes teams can exchange hours operationally; skill/certification constraints are not modeled in v1.
- Productivity is treated as a team-level historical conversion rate and may shift under unusual demand or staffing mixes.
- Linear trend + residual bootstrap is intentionally interpretable, not a long-horizon forecasting system.
- Forecast uncertainty can be understated with short or structurally changing history.
- Employee IDs are not used for performance scoring.

## Local development

```bash
npm install
npm test
npm run build
npm run dev
```

## Tests

Regression checks cover CSV parsing, validation, absence-adjusted capacity, forecast horizon behavior, service-quantile monotonicity, reallocation-before-hiring logic, and operational CSV export.
