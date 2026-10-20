export function receiptSuggestions(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const totals = lines.filter(
    (s) =>
      /\b(total|amount paid|amount due)\b/i.test(s) &&
      !/(subtotal|sub total|tax|discount)/i.test(s),
  );
  const values = totals.flatMap((s) => s.match(/\d[\d,]*\.\d{2}\b/g) || []);
  const amount = values.length
    ? values[values.length - 1].replace(/,/g, "")
    : "";
  const iso = text.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  const dmy = text.match(/\b(\d{2})[-/](\d{2})[-/](20\d{2})\b/);
  const candidate = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : dmy
      ? `${dmy[3]}-${dmy[2]}-${dmy[1]}`
      : "";
  const date =
    candidate &&
    !Number.isNaN(Date.parse(candidate)) &&
    new Date(candidate).toISOString().slice(0, 10) === candidate
      ? candidate
      : "";
  const payee =
    lines
      .find(
        (s) => /[a-z]{3}/i.test(s) && !/(receipt|invoice|tax|date)/i.test(s),
      )
      ?.slice(0, 180) || "";
  const reference =
    text.match(
      /(?:receipt|invoice)\s*(?:no\.?|number|#|:)\s*([a-z0-9-]+)/i,
    )?.[1] || "";
  return {
    amount,
    date,
    payee,
    reference,
    description: payee ? `Purchase from ${payee}` : "",
  };
}
