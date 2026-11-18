/* CSV building, shared by the side panel and the swipe file export. */
self.PG = self.PG || {};

self.PG.csv = (function () {
  function cell(value) {
    if (value === null || value === undefined) return "";
    let text = String(value);
    // A caption starting with = + - @ would run as a formula in Excel or Sheets.
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  /** columns: [{ header, value: (row) => any }]. Starts with a BOM so Excel reads UTF-8. */
  function build(rows, columns) {
    const lines = [columns.map((c) => cell(c.header)).join(",")];
    for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(","));
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  return { build };
})();
