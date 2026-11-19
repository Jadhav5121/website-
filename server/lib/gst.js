// GST helpers. Prices shown to customers include GST, so tax is extracted from the inclusive amount.
// Apparel slabs change over time: keep the rates and threshold editable in Admin → Settings.

function gstRateFor(unitPricePaise, settings) {
  return unitPricePaise > settings.thresholdPaise ? settings.highRate : settings.lowRate;
}

// Returns the GST inside an amount that already includes tax.
function taxInclusive(amountPaise, unitPricePaise, settings) {
  const rate = gstRateFor(unitPricePaise, settings);
  const tax = Math.round((amountPaise * rate) / (100 + rate));
  return { rate, tax, taxable: amountPaise - tax };
}

// Financial year label, for example "2026-27" for dates from April 2026 to March 2027.
function financialYear(date = new Date()) {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

module.exports = { gstRateFor, taxInclusive, financialYear };
