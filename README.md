# CLI Reconcile

CLI Reconcile is a browser-based payroll review tool for bi-weekly pay periods. It compares When I Work schedule exports against PRS Timekeeping time cards and lists the employee-days that need a closer look. Everything runs locally in the browser, so no payroll data leaves the device.

## Quick start

Open `index.html` in a modern browser.

1. Choose one **When I Work schedule** CSV.
2. Choose all relevant **PRS time card** CSV exports (multi-select is supported).
3. Optionally choose an **Employee Lookup** CSV. It resolves the PRS employee code to the employee name and recognizes the work or personal email listed in the lookup.
4. Select **Compare records**, then review, filter, search and download the exception list.

## How matching works

The schedule export has blank employee IDs, so records are matched on employee name, work date, total daily hours and the daily clock-time span. When a lookup file is supplied, the PRS code resolves the time card identity and the lookup emails resolve schedule identities.

Each employee's whole day is reviewed together before anything is flagged. All rows for the same employee and date are grouped, and the day is judged on its total. This also supports PRS exports that consolidate or split consecutive shifts.

The schedule is limited to the pay period printed on the uploaded PRS reports, so out-of-period schedule rows do not create false exceptions.

### What is ignored

- **Dash placeholders.** A hyphen (`-`), en dash (`–`), em dash (`—`) or similar entered as a time or value is treated as empty. Rows containing only dashes are non-comparable and never create a missing-time exception.
- **Mileage entries.** `Client Miles( Enter Miles Only)`, `Staff Miles( Enter Miles Only)` and similar rows with no clock times are not worked time. If a mileage row does carry clock times, those times count as worked time, and hours are calculated from the clock times because its Hours column holds miles.
- **Note and total lines.** Lines such as `Total hours clocked for week of ...` and `Note: ...` are not time entries and do not affect dates.
- **Published OFF shifts.**
- **Duplicate punches.** An identical start and end time repeated on the same day is counted once.

### Paid leave and overnight shifts

- Sick, vacation and PTO entries count toward the day's hours. A scheduled day covered by leave is not reported as missing. It is flagged only if the leave hours do not match the schedule. Leave on an unscheduled day is not flagged.
- Shifts that run past midnight are compared correctly.

## Exceptions

| Exception | Meaning |
|---|---|
| Missing time record | A shift was scheduled but no worked time was recorded. |
| Unscheduled worked time | Time was worked with no published schedule. |
| Hours mismatch | Daily totals differ by more than 0.10 hours (6 minutes). |
| Clock-time mismatch | The day's start or end differs by more than 15 minutes while the hours agree. |

Priority: missing time, unscheduled time and hours differences of 1 hour or more are **high**. Smaller hours differences and clock-time mismatches are **medium**.

Default thresholds are 15 minutes for clock times and 0.10 hours (6 minutes) for daily totals.

## Output

- Summary counts: total exceptions, high priority, hours mismatch and missing time.
- A filterable, searchable results table.
- A downloadable exceptions CSV (`cli-reconciliation-exceptions.csv`).

Review flags are decision support, not payroll edits. Confirm exceptions against source records before making changes.

## Limitations

This prototype implements transparent schedule-versus-time-card checks. Microsoft Forms and documentation matching would require a Forms export and agreed documentation fields before it can be included safely.

## Files

- `index.html`: page structure
- `styles.css`: styling
- `app.js`: CSV parsing, matching and reconciliation logic
