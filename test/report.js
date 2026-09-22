'use strict';

// Formatting for the adapter test output: the table rows that are updated while the adapters
// run, and the summary printed afterwards.

const { styleText } = require('node:util');
const { figures } = require('listr2');

const SEPARATOR = '  ';
// Listr2 puts an icon and a space in front of every row, so lines printed on their own are
// indented by the same amount to line up with the rows.
const INDENT = '  ';
const WIDTH = {
  municipality: 28,
  interface: 9,
  fetch: 5,
  pickup: 11,
  progress: 52,
  time: 6,
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The tick and cross recur in the status cells, the per-adapter icon and the failure list, always
// in the same colour, so they are defined once here.
const GLYPH = {
  tick: () => styleText('green', figures.tick),
  cross: () => styleText('red', figures.cross),
};

const STATUS_GLYPHS = {
  pending: () => styleText('dim', '·'),
  running: () => styleText('yellow', '…'),
  ok: GLYPH.tick,
  fail: GLYPH.cross,
  skip: () => styleText('dim', '–'),
};

function fit(text, width) {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

function statusCell(status, width) {
  return STATUS_GLYPHS[status]() + ' '.repeat(width - 1);
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPickup(date) {
  if (!date) return '';
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function timeCell(ms) {
  return ms === null ? '' : formatDuration(ms).padStart(WIDTH.time);
}

function header(columns) {
  const titles = columns.map(([title, width, align]) => (
    align === 'right' ? title.padStart(width) : title.padEnd(width)
  ));
  const ruleWidth = columns.reduce((sum, [, width]) => sum + width, 0)
    + SEPARATOR.length * (columns.length - 1);
  return `${INDENT}${styleText('bold', titles.join(SEPARATOR).trimEnd())}\n${INDENT}${styleText('dim', '─'.repeat(ruleWidth))}`;
}

// The table for a test run: one row per adapter.
const testTable = {
  newView: (name) => ({
    name,
    queued: true,
    municipality: '',
    interface: 'pending',
    fetch: 'pending',
    pickup: '',
    ms: null,
  }),

  header: (nameWidth) => header([
    ['Adapter', nameWidth],
    ['Municipality', WIDTH.municipality],
    ['Interface', WIDTH.interface],
    ['Fetch', WIDTH.fetch],
    ['Next pickup', WIDTH.pickup],
    ['Time', WIDTH.time, 'right'],
  ]),

  row: (nameWidth, view) => [
    fit(view.name, nameWidth),
    view.queued
      ? styleText('dim', fit('queued', WIDTH.municipality))
      : fit(view.municipality, WIDTH.municipality),
    statusCell(view.interface, WIDTH.interface),
    statusCell(view.fetch, WIDTH.fetch),
    fit(view.pickup, WIDTH.pickup),
    timeCell(view.ms),
  ].join(SEPARATOR).trimEnd(),
};

// The table for --update-addresses: one row per adapter with free text on how it is going.
const updateTable = {
  newView: (name) => ({
    name,
    queued: true,
    progress: '',
    ms: null,
  }),

  header: (nameWidth) => header([
    ['Adapter', nameWidth],
    ['Progress', WIDTH.progress],
    ['Time', WIDTH.time, 'right'],
  ]),

  row: (nameWidth, view) => [
    fit(view.name, nameWidth),
    view.queued
      ? styleText('dim', fit('queued', WIDTH.progress))
      : fit(view.progress, WIDTH.progress),
    timeCell(view.ms),
  ].join(SEPARATOR).trimEnd(),
};

function icon(ok) {
  return ok ? GLYPH.tick() : GLYPH.cross();
}

// results: [{ name, failures: [{ reason, label?, address? }] }]. An adapter passes when it has
// no failures.
function printSummary(results, elapsedMs, passedWord) {
  const failed = results.filter((result) => result.failures.length > 0);
  const passed = results.length - failed.length;
  const failedText = `${figures.cross} ${failed.length} failed`;
  console.log('');
  console.log([
    INDENT + styleText('green', `${figures.tick} ${passed} ${passedWord}`),
    failed.length > 0 ? styleText('red', failedText) : styleText('dim', failedText),
    styleText('dim', formatDuration(elapsedMs)),
  ].join('   '));
  if (failed.length === 0) return;

  console.log('');
  console.log(INDENT + styleText('bold', 'Failures'));
  for (const result of failed) {
    for (const failure of result.failures) {
      const where = failure.address ? `${failure.label} (${failure.address})` : failure.label;
      console.log(`${INDENT}${GLYPH.cross()} ${[result.name, where].filter(Boolean).join('  ')}`);
      console.log(`${INDENT}    ${failure.reason}`);
    }
  }
}

module.exports = {
  testTable,
  updateTable,
  icon,
  formatPickup,
  printSummary,
};
