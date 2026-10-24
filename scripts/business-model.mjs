// Commercial scenario calculator only. This does not change reservation rules or take payments.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function calculateModel(input) {
  const c = input.common;
  const outcomes = ['success', 'no_show', 'operator_failure', 'cancelled'];
  const nonnegative = (name, value) => {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite nonnegative number`);
  };
  const requiredCommonNumbers = [
    'days_per_month', 'equipped_bays_per_site', 'bookings_per_bay_day',
    'saas_per_bay_month_eur_net', 'installed_hardware_per_bay_eur_net', 'hardware_life_months',
    'cpo_operations_per_bay_month_eur_net', 'authorization_cost_per_booking_eur',
    'goodwill_cost_per_operator_failure_eur', 'paid_success_fee_eur_gross',
    'success_fee_vat_rate_assumed', 'paid_fee_cpo_share_after_tax_and_processing',
    'no_show_fee_eur_gross_ceiling', 'no_show_vat_rate_provisional',
    'no_show_billable_fraction_after_waivers', 'card_processing_rate', 'card_processing_fixed_eur',
    'bayready_variable_cost_per_bay_month_eur_net', 'bayready_fixed_cost_per_month_eur_net',
    'bayready_acquisition_cost_per_bay_eur_net', 'customer_lifetime_months_assumed'
  ];
  for (const name of requiredCommonNumbers) {
    nonnegative(name, c[name]);
  }
  for (const outcome of outcomes) {
    nonnegative(`outcome_rates.${outcome}`, c.outcome_rates[outcome]);
    nonnegative(`empty_hold_minutes.${outcome}`, c.empty_hold_minutes[outcome]);
    if (c.empty_hold_minutes[outcome] > 10) throw new Error('This model uses a ten-minute total hold policy');
  }
  const rateSum = outcomes.reduce((sum, outcome) => sum + c.outcome_rates[outcome], 0);
  if (Math.abs(rateSum - 1) > 1e-9) throw new Error('Exclusive outcome rates must sum to 1');
  if (c.days_per_month <= 0 || c.hardware_life_months <= 0 || c.equipped_bays_per_site <= 0) {
    throw new Error('Days, hardware life and equipped bay count must be positive');
  }
  for (const key of ['paid_fee_cpo_share_after_tax_and_processing', 'no_show_billable_fraction_after_waivers', 'card_processing_rate']) {
    if (c[key] > 1) throw new Error(`${key} must be between 0 and 1`);
  }
  const bookings = c.bookings_per_bay_day * c.days_per_month;
  const counts = Object.fromEntries(outcomes.map(outcome => [outcome, bookings * c.outcome_rates[outcome]]));
  const heldMinutes = outcomes.reduce((sum, outcome) => sum + counts[outcome] * c.empty_hold_minutes[outcome], 0);
  const hardwareAllocation = c.installed_hardware_per_bay_eur_net / c.hardware_life_months;
  const authCost = bookings * c.authorization_cost_per_booking_eur;
  const goodwillCost = counts.operator_failure * c.goodwill_cost_per_operator_failure_eur;
  const cashCost = c.saas_per_bay_month_eur_net + c.cpo_operations_per_bay_month_eur_net + authCost + goodwillCost;
  const economicCost = cashCost + hardwareAllocation;
  const processingFor = gross => gross > 0 ? c.card_processing_fixed_eur + c.card_processing_rate * gross : 0;
  const paidProcessing = processingFor(c.paid_success_fee_eur_gross);
  const paidPool = counts.success * (c.paid_success_fee_eur_gross / (1 + c.success_fee_vat_rate_assumed) - paidProcessing);
  const paidCpo = paidPool * c.paid_fee_cpo_share_after_tax_and_processing;
  const paidPlatform = paidPool * (1 - c.paid_fee_cpo_share_after_tax_and_processing);
  const billedNoShows = counts.no_show * c.no_show_billable_fraction_after_waivers;
  const noShowProcessing = processingFor(c.no_show_fee_eur_gross_ceiling);
  const noShowRecovery = billedNoShows * (c.no_show_fee_eur_gross_ceiling / (1 + c.no_show_vat_rate_provisional) - noShowProcessing);
  if (!Array.isArray(input.scenarios) || input.scenarios.length === 0) throw new Error('At least one scenario is required');
  const rows = input.scenarios.map(s => {
    if (typeof s.name !== 'string' || !s.name.trim()) throw new Error('Each scenario needs a name');
    for (const key of ['gross_restored_bay_minutes_per_day', 'demand_probability_restored', 'demand_probability_held', 'average_delivered_power_kw', 'energy_contribution_per_kwh_eur_net']) {
      nonnegative(key, s[key]);
    }
    for (const key of ['demand_probability_restored', 'demand_probability_held']) {
      if (s[key] > 1) throw new Error(`${key} must be between 0 and 1`);
    }
    const restoredMinutes = s.gross_restored_bay_minutes_per_day * c.days_per_month;
    if (Math.max(restoredMinutes, heldMinutes) > c.days_per_month * 1440) throw new Error('Bay-minutes exceed calendar capacity');
    // Restored availability and deliberate empty holds can face different demand pressure.
    // Preserve negative energy: reservations can displace more charging than they recover.
    const netChargingMinutes = s.demand_probability_restored * restoredMinutes - s.demand_probability_held * heldMinutes;
    const netEnergy = netChargingMinutes * s.average_delivered_power_kw / 60;
    const energyContribution = netEnergy * s.energy_contribution_per_kwh_eur_net;
    const core = energyContribution - economicCost;
    const cash = energyContribution - cashCost;
    const marginalRestoredMinute = s.demand_probability_restored * s.average_delivered_power_kw / 60 * s.energy_contribution_per_kwh_eur_net;
    const lostHoldContribution = s.demand_probability_held * heldMinutes * s.average_delivered_power_kw / 60 * s.energy_contribution_per_kwh_eur_net;
    return {
      scenario: s.name,
      bookings_per_bay_month: bookings,
      successes_per_bay_month: counts.success,
      no_shows_per_bay_month: counts.no_show,
      operator_failures_per_bay_month: counts.operator_failure,
      cancellations_per_bay_month: counts.cancelled,
      held_empty_minutes_per_bay_month: heldMinutes,
      restored_minutes_per_bay_month: restoredMinutes,
      net_incremental_charging_minutes_per_bay_month: netChargingMinutes,
      net_incremental_kwh_per_bay_month: netEnergy,
      energy_contribution_eur: energyContribution,
      saas_cost_eur: c.saas_per_bay_month_eur_net,
      hardware_allocation_eur: hardwareAllocation,
      cpo_operations_cost_eur: c.cpo_operations_per_bay_month_eur_net,
      authorization_cost_eur: authCost,
      goodwill_cost_eur: goodwillCost,
      total_economic_cost_eur: economicCost,
      core_cpo_result_per_bay_eur: core,
      core_cpo_result_per_site_eur: core * c.equipped_bays_per_site,
      core_cpo_cash_before_hardware_capex_eur: cash,
      simple_hardware_cash_payback_months: cash > 0 ? c.installed_hardware_per_bay_eur_net / cash : null,
      break_even_restored_minutes_per_bay_day: marginalRestoredMinute > 0 ? (economicCost + lostHoldContribution) / marginalRestoredMinute / c.days_per_month : null,
      optional_no_show_recovery_eur_excluded_from_core: noShowRecovery,
      optional_paid_fee_cpo_share_eur: paidCpo,
      optional_paid_fee_bayready_share_eur: paidPlatform,
      paid_mode_cpo_result_excluding_no_shows_eur: core + paidCpo,
      // €1 + a €1 charging credit is zero incremental revenue, by design.
      credited_success_fee_incremental_revenue_eur: 0
    };
  });
  const contribution = c.saas_per_bay_month_eur_net - c.bayready_variable_cost_per_bay_month_eur_net;
  return {
    status: input.status,
    basis: 'Monthly incremental per equipped bay unless labelled per site; financial results net of modelled VAT; no-show receipts excluded from core',
    assumptions: c,
    scenarios: rows,
    platform: {
      saas_contribution_per_bay_eur: contribution,
      saas_gross_margin_fraction: c.saas_per_bay_month_eur_net > 0 ? contribution / c.saas_per_bay_month_eur_net : null,
      operating_break_even_active_bays: contribution > 0 ? Math.ceil(c.bayready_fixed_cost_per_month_eur_net / contribution) : null,
      acquisition_payback_months: contribution > 0 ? c.bayready_acquisition_cost_per_bay_eur_net / contribution : null,
      contribution_lifetime_value_eur: contribution * c.customer_lifetime_months_assumed,
      contribution_ltv_to_cac: c.bayready_acquisition_cost_per_bay_eur_net > 0 ? contribution * c.customer_lifetime_months_assumed / c.bayready_acquisition_cost_per_bay_eur_net : null
    }
  };
}

function csv(rows) {
  const columns = Object.keys(rows[0]);
  const cell = value => {
    if (value === null) return '';
    if (typeof value === 'number') return value.toFixed(6);
    return `"${String(value).replaceAll('"', '""')}"`;
  };
  return `${columns.join(',')}\n${rows.map(row => columns.map(key => cell(row[key])).join(',')).join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const pathFlag = args.indexOf('--assumptions');
    if (pathFlag !== -1 && (!args[pathFlag + 1] || args[pathFlag + 1].startsWith('--'))) throw new Error('--assumptions needs a JSON file path');
    const inputPath = pathFlag === -1 ? new URL('../docs/business-model/assumptions.json', import.meta.url) : args[pathFlag + 1];
    const result = calculateModel(JSON.parse(readFileSync(inputPath, 'utf8')));
    process.stdout.write(args.includes('--csv') ? csv(result.scenarios) : `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Business model: ${error.message}\n`);
    process.exitCode = 1;
  }
}
