const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../game-data-core.js');

const time = '2026-11-19T00:00:00.000Z';
const raw = (payload, extra = {}) => ({ command: 'get.new.user.info', payload, observed_at: time, ...extra });
const canonical = (row, extra = {}) => ({ uid: '123456', source: 'get.new.user.info', observed_at: time, ...row, ...extra });
const bridge = observations => ({ schema_version: 1, observations });

test('maps verified profile fields, zero, aliases, and exact UID', () => {
  const [row] = core.normalize(raw({
    uid: '00123456789012345678', name: 'Synthetic', abbr: 'ABC', serverId: '213',
    power: '2266827241', migratePower: 2000, armyPower: 1, heroPower: 2,
    buildingPower: 3, sciencePower: 4, petPower: 5, modCarPower: 6,
    armyKill: 0, baseLevel: 80,
  }));
  assert.deepEqual(row, {
    uid: '00123456789012345678', name: 'Synthetic', alliance: 'ABC', server: 213,
    total_power: 2266827241, migration_power: 2000, army_power: 1, hero_power: 2,
    building_power: 3, science_power: 4, pet_power: 5, vehicle_power: 6,
    kills: 0, base_level: 80, observed_at: time, source: 'get.new.user.info',
  });
});

test('supports data/info wrapper and explicit caller time without inventing one', () => {
  const [row] = core.normalize({
    command: 'migrate.user.info', data: { code: 0, info: { uid: 123456, playerPower: 0, alAbbr: 'SYN', belongSid: 213 } },
  }, { observedAt: '2026-11-19T09:00:00+09:00' });
  assert.equal(row.observed_at, time);
  assert.equal(row.total_power, 0);
  assert.equal(row.alliance, 'SYN');
  assert.equal(row.server, 213);
  assert.throws(() => core.normalize({ command: 'get.new.user.info', payload: { uid: '123456' } }), /observed_at/);
});

test('strips secrets from raw and canonical paths, and never infers squad power', () => {
  const payload = { uid: '123456', power: 300, token: 'secret', password: 'pw', uuid: 'private', f1_power: 999, squad1: 999 };
  const [rawRow] = core.normalize(raw(payload, { source: 'secret-source', token: 'outer-secret' }));
  assert.deepEqual(Object.keys(rawRow).sort(), ['uid', 'total_power', 'observed_at', 'source'].sort());
  const [row] = core.normalize(bridge([{ ...rawRow, token: 'secret', cookie: 'private', f1_power: 111 }]));
  assert.deepEqual(row, rawRow);
  assert.equal(JSON.stringify(row).includes('secret'), false);
});

test('rejects unknown source/command, malformed IDs, unsafe metrics, and response failures', () => {
  assert.throws(() => core.normalize(raw({ uid: '123456' }, { command: 'unknown' })));
  assert.throws(() => core.normalize(bridge([canonical({}, { source: 'arbitrary' })])));
  for (const uid of ['12345', '1'.repeat(21), '１２３４５６', '1e6', true, 123456.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => core.normalize(raw({ uid })));
  }
  for (const power of [true, false, 1.5, -1, '1.0', '1e3', ' 5', Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    assert.throws(() => core.normalize(raw({ uid: '123456', power })));
  }
  assert.throws(() => core.normalize(raw({ uid: '123456', power: 1, playerPower: 2 })));
  assert.throws(() => core.normalize(raw({ code: 10018, info: { uid: '123456' } })));
  assert.throws(() => core.normalize(raw({ uid: '123456' }, { data: {} })));
  assert.equal(core.normalize(raw({ uid: '123456', power: Number.MAX_SAFE_INTEGER }))[0].total_power, Number.MAX_SAFE_INTEGER);
});

test('timestamps require a timezone and reject rollover dates', () => {
  for (const value of ['2026-11-19T00:00:00', 'yesterday', '2026-02-30T00:00:00Z', '2026-11-19T25:00:00Z', '2026-11-19T00:00:00+24:00', 123]) {
    assert.throws(() => core.normalize(raw({ uid: '123456' }, { observed_at: value })));
  }
  const [row] = core.normalize(raw({ uid: '123456' }, { observed_at: '2026-11-19T09:00:00.123456+09:00' }));
  assert.equal(row.observed_at, '2026-11-19T00:00:00.123456Z');
});

test('merge uses latest value per field; stale rows and missing fields do not erase values', () => {
  const latest = canonical({ migration_power: 0 }, { observed_at: '2026-11-19T02:00:00Z', source: 'migrate.user.info' });
  const older = canonical({ total_power: 100, migration_power: 80, name: 'Old' });
  const middle = canonical({ name: 'New', hero_power: 5 }, { observed_at: '2026-11-19T01:00:00Z' });
  const [row] = core.mergeLatest([latest, middle, older]);
  assert.equal(row.total_power, 100);
  assert.equal(row.migration_power, 0);
  assert.equal(row.name, 'New');
  assert.equal(row.hero_power, 5);
  assert.equal(row.observed_at, '2026-11-19T02:00:00.000Z');
  assert.equal(row.field_observed_at.total_power, time);
  assert.equal(row.field_observed_at.migration_power, row.observed_at);
  assert.equal(row.field_source.migration_power, 'migrate.user.info');
  assert.equal(row.field_source.total_power, 'get.new.user.info');
  assert.equal('army_power' in row, false);
  assert.equal('total_power' in latest, false);
});

test('merge retains submillisecond ordering and sorts resulting UID rows', () => {
  const rows = core.mergeLatest([
    canonical({ total_power: 2 }, { observed_at: '2026-11-19T00:00:00.000002Z' }),
    canonical({ total_power: 1 }, { observed_at: '2026-11-19T00:00:00.000001Z' }),
    canonical({ uid: '100000' }),
  ]);
  assert.equal(rows[0].uid, '100000');
  assert.equal(rows[1].total_power, 2);
});

test('CSV quotes IDs without formulas and neutralizes formula text', () => {
  const csv = core.toCSV([
    canonical({ uid: '00123456789012345678', name: '=SUM(1,2)', alliance: '\t@formula', total_power: 0 }),
    canonical({ uid: '654321', name: 'A,"B"\nC', alliance: '-cmd' }),
  ]);
  assert.ok(csv.startsWith('uid,name,alliance,server,total_power,'));
  assert.ok(csv.includes('"00123456789012345678"'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"\'\t@formula"'));
  assert.ok(csv.includes('"A,""B""\nC"'));
  assert.equal(csv.includes('="001234'), false);
  assert.equal(csv.includes('field_observed_at'), false);
});

test('CSV preserves per-field capture time and source after a partial update', () => {
  const merged = core.mergeLatest([
    canonical({total_power: 123}, {observed_at: '2026-11-18T00:00:00Z'}),
    canonical({migration_power: 45}, {source: 'migrate.user.info', observed_at: '2026-11-19T00:00:00Z'}),
  ]);
  const csv = core.toCSV(merged);
  const headers = csv.split('\r\n')[0].split(',');
  assert.ok(headers.includes('total_power_observed_at'));
  assert.ok(headers.includes('migration_power_source'));
  assert.ok(csv.includes('2026-11-18T00:00:00.000Z'));
  assert.ok(csv.includes('get.new.user.info'));
  assert.ok(csv.includes('migrate.user.info'));
});

test('timestamps stay within database microsecond precision', () => {
  assert.throws(() => core.normalize({schema_version:1,observations:[canonical({}, {observed_at:'2026-11-19T00:00:00.1234567Z'})]}));
});

test('recent ordering compares fractional instants rather than variable-length strings', () => {
  assert.ok(core.compareObservedAt('2026-11-19T00:00:00.000Z','2026-11-19T00:00:00.000001Z') < 0);
  assert.equal(core.compareObservedAt('2026-11-19T09:00:00+09:00','2026-11-19T00:00:00Z'),0);
});

test('formatPower is display-only and handles missing and invalid values', () => {
  assert.equal(core.formatPower(0), '0');
  assert.equal(core.formatPower(1200), '1.2K');
  assert.equal(core.formatPower(1230000), '1.23M');
  assert.equal(core.formatPower(2266827241), '2.27G');
  assert.equal(core.formatPower(null), '-');
  assert.equal(core.formatPower(1.5), '-');
});

test('UMD exposes the same API in a browser global with no DOM or network', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../game-data-core.js'), 'utf8'), context);
  assert.equal(typeof context.DWGameData.normalize, 'function');
  assert.equal(context.DWGameData.formatPower(1000), '1K');
});
