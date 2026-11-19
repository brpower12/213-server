(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DWGameData = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Pure data boundary: no DOM, network, login, or implicit observation clock.
  var COMMANDS = ['get.new.user.info', 'migrate.user.info'];
  var METRICS = {
    server: ['serverId', 'belongSid'],
    total_power: ['power', 'playerPower'],
    migration_power: ['migratePower'],
    army_power: ['armyPower'],
    hero_power: ['heroPower'],
    building_power: ['buildingPower'],
    science_power: ['sciencePower'],
    pet_power: ['petPower'],
    vehicle_power: ['modCarPower'],
    kills: ['armyKill'],
    base_level: ['baseLevel']
  };
  var METRIC_KEYS = Object.keys(METRICS);
  var VALUE_KEYS = ['name', 'alliance'].concat(METRIC_KEYS);
  var CSV_KEYS = ['uid'].concat(VALUE_KEYS, ['observed_at', 'source']);
  var own = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };
  var isObject = function (value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  };

  function fail(message) { throw new TypeError(message); }

  function integer(value, field) {
    if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
      var significant = value.replace(/^0+/, '') || '0';
      if (significant.length > 16) fail(field + ' exceeds the safe integer range');
      value = Number(significant);
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      fail(field + ' must be a nonnegative safe integer');
    }
    return value === 0 ? 0 : value;
  }

  function uid(value) {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 100000) fail('uid must contain 6 to 20 digits');
      value = String(value);
    }
    if (typeof value !== 'string' || !/^[0-9]{6,20}$/.test(value)) {
      fail('uid must contain 6 to 20 digits');
    }
    return value;
  }

  function timestamp(value) {
    if (typeof value !== 'string') fail('observed_at must be a timezone-aware ISO timestamp');
    var match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) fail('observed_at must be a timezone-aware ISO timestamp');
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
        Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59) {
      fail('observed_at contains an invalid date or time');
    }
    if (match[8] !== 'Z' && (Number(match[8].slice(1, 3)) > 23 || Number(match[8].slice(4)) > 59)) {
      fail('observed_at contains an invalid timezone');
    }
    var fraction = match[7] || '';
    var normalizedInput = match[1] + '-' + match[2] + '-' + match[3] + 'T' +
      match[4] + ':' + match[5] + ':' + (match[6] || '00') +
      (fraction ? '.' + fraction.slice(0, 3).padEnd(3, '0') : '') + match[8];
    var time = new Date(normalizedInput);
    if (!Number.isFinite(time.getTime())) fail('observed_at contains an invalid date or time');
    // Keep submillisecond precision from Python's ISO output, so imports that
    // differ by microseconds still merge in the correct order.
    var iso = time.toISOString();
    if (fraction.length > 3) iso = iso.slice(0, -1) + fraction.slice(3) + 'Z';
    return iso;
  }

  function compareTimes(a, b) {
    var delta = Date.parse(a) - Date.parse(b);
    if (delta) return delta;
    var fraction = function (value) {
      var match = /\.(\d+)Z$/.exec(value);
      return (match ? match[1] : '').padEnd(9, '0');
    };
    var af = fraction(a), bf = fraction(b);
    return af < bf ? -1 : af > bf ? 1 : 0;
  }

  function readText(profile, key, target) {
    if (own(profile, key) && profile[key] != null) {
      if (typeof profile[key] !== 'string') fail(target + ' must be a string');
      return profile[key];
    }
    return undefined;
  }

  function observationTime(value, fallback) {
    if (value != null) return timestamp(value);
    if (fallback !== undefined) return fallback;
    fail('observed_at is required; provide an explicit observation time');
  }

  function normalizeCanonical(profile, fallback) {
    if (!isObject(profile)) fail('each canonical observation must be an object');
    if (!own(profile, 'source') || COMMANDS.indexOf(profile.source) === -1) {
      fail('unsupported canonical observation source');
    }
    var record = { uid: uid(own(profile, 'uid') ? profile.uid : undefined) };
    ['name', 'alliance'].forEach(function (key) {
      var value = readText(profile, key, key);
      if (value !== undefined) record[key] = value;
    });
    METRIC_KEYS.forEach(function (key) {
      if (own(profile, key) && profile[key] != null) record[key] = integer(profile[key], key);
    });
    record.observed_at = observationTime(own(profile, 'observed_at') ? profile.observed_at : undefined, fallback);
    record.source = profile.source;
    return record;
  }

  function normalizeEnvelope(envelope, fallback) {
    if (!isObject(envelope)) fail('each observation must be an object');
    if (!own(envelope, 'command') || COMMANDS.indexOf(envelope.command) === -1) {
      fail('unsupported observation command');
    }
    var hasPayload = own(envelope, 'payload'), hasData = own(envelope, 'data');
    if (hasPayload === hasData) fail('an observation requires exactly one of payload or data');
    var profile = hasPayload ? envelope.payload : envelope.data;
    if (!isObject(profile)) fail('payload must be a decoded profile object');
    if (own(profile, 'code') && (typeof profile.code !== 'number' || profile.code !== 0)) {
      fail('payload reports an unsuccessful response');
    }
    if (own(profile, 'info')) profile = profile.info;
    if (!isObject(profile)) fail('info must be a decoded profile object');
    var record = { uid: uid(own(profile, 'uid') ? profile.uid : undefined) };
    var name = readText(profile, 'name', 'name');
    if (name !== undefined) record.name = name;
    ['abbr', 'alAbbr', 'allianceName'].some(function (alias) {
      var value = readText(profile, alias, 'alliance');
      if (value === undefined) return false;
      record.alliance = value;
      return true;
    });
    METRIC_KEYS.forEach(function (key) {
      var values = METRICS[key].filter(function (alias) {
        return own(profile, alias) && profile[alias] != null;
      }).map(function (alias) { return integer(profile[alias], key); });
      if (!values.length) return;
      if (values.some(function (value) { return value !== values[0]; })) fail('conflicting aliases for ' + key);
      record[key] = values[0];
    });
    record.observed_at = observationTime(own(envelope, 'observed_at') ? envelope.observed_at : undefined, fallback);
    record.source = envelope.command;
    return record;
  }

  function normalize(input, options) {
    options = options || {};
    var fallback = options.observedAt == null ? undefined : timestamp(options.observedAt);
    if (isObject(input) && own(input, 'schema_version')) {
      if (input.schema_version !== 1 || !Array.isArray(input.observations)) fail('unsupported observation bridge schema');
      return input.observations.map(function (row) { return normalizeCanonical(row, fallback); });
    }
    var envelopes = Array.isArray(input) ? input : [input];
    return envelopes.map(function (envelope) { return normalizeEnvelope(envelope, fallback); });
  }

  function mergeLatest(observations) {
    var rows = normalize({ schema_version: 1, observations: observations });
    var ordered = rows.map(function (row, index) { return { row: row, index: index }; });
    ordered.sort(function (a, b) {
      return compareTimes(a.row.observed_at, b.row.observed_at) || a.index - b.index;
    });
    var byUid = new Map();
    ordered.forEach(function (item) {
      var row = item.row;
      var target = byUid.get(row.uid);
      if (!target) {
        target = { uid: row.uid, field_observed_at: {}, field_source: {} };
        byUid.set(row.uid, target);
      }
      VALUE_KEYS.forEach(function (field) {
        if (own(row, field)) {
          target[field] = row[field];
          target.field_observed_at[field] = row.observed_at;
          target.field_source[field] = row.source;
        }
      });
      target.observed_at = row.observed_at;
      target.source = row.source;
    });
    return Array.from(byUid.values()).sort(function (a, b) {
      return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
    });
  }

  function toCSV(rows) {
    var clean = normalize({ schema_version: 1, observations: rows });
    var provenanceKeys = VALUE_KEYS.reduce(function (keys, field) {
      return keys.concat([field + '_observed_at', field + '_source']);
    }, []);
    var exportKeys = CSV_KEYS.concat(provenanceKeys);
    var cell = function (value) {
      if (value == null) return '';
      var text = String(value);
      if (typeof value === 'string' && (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) {
        text = "'" + text;
      }
      return '"' + text.replace(/"/g, '""') + '"';
    };
    // CSV does not encode column types. Import uid as a text column in Sheets
    // or Excel to retain leading zeros and more than 15 digits. No formulas are
    // generated to force a spreadsheet type.
    var lines = [exportKeys.join(',')];
    clean.forEach(function (row, index) {
      var original = rows[index];
      VALUE_KEYS.forEach(function (field) {
        if (!own(row, field)) return;
        var when = original.field_observed_at && original.field_observed_at[field];
        var source = original.field_source && original.field_source[field];
        if (source != null && COMMANDS.indexOf(source) === -1) fail('unsupported field provenance source');
        row[field + '_observed_at'] = when == null ? row.observed_at : timestamp(when);
        row[field + '_source'] = source == null ? row.source : source;
      });
      lines.push(exportKeys.map(function (key) { return own(row, key) ? cell(row[key]) : ''; }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  function formatPower(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return '-';
    var suffix = '', divisor = 1;
    if (value >= 1e9) { suffix = 'G'; divisor = 1e9; }
    else if (value >= 1e6) { suffix = 'M'; divisor = 1e6; }
    else if (value >= 1e3) { suffix = 'K'; divisor = 1e3; }
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value / divisor) + suffix;
  }

  return Object.freeze({ normalize: normalize, mergeLatest: mergeLatest, toCSV: toCSV, formatPower: formatPower,
    compareObservedAt: function (a, b) { return compareTimes(timestamp(a), timestamp(b)); } });
}));
