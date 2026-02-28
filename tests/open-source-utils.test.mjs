import test from 'node:test';
import assert from 'node:assert/strict';
import { toOpenWeatherAqi, pickFlightStatus, mapGenreLabelToId } from '../lib/testing/open-source-utils.mjs';

test('AQI conversion maps US AQI to OpenWeather scale', () => {
  assert.equal(toOpenWeatherAqi(25), 1);
  assert.equal(toOpenWeatherAqi(75), 2);
  assert.equal(toOpenWeatherAqi(125), 3);
  assert.equal(toOpenWeatherAqi(175), 4);
  assert.equal(toOpenWeatherAqi(250), 5);
  assert.equal(toOpenWeatherAqi(null), 0);
});

test('flight status selection prefers explicit on-ground/in-air', () => {
  const now = 1_700_000_000;
  assert.equal(pickFlightStatus(false, null, null, now), 'in_air');
  assert.equal(pickFlightStatus(true, null, null, now), 'on_ground');
  assert.equal(pickFlightStatus(undefined, now - 1200, null, now), 'active');
  assert.equal(pickFlightStatus(undefined, now - 5000, now - 5000, now), 'scheduled');
});

test('genre mapping returns TMDB-compatible ids', () => {
  assert.equal(mapGenreLabelToId('Action'), 28);
  assert.equal(mapGenreLabelToId('Drama'), 18);
  assert.equal(mapGenreLabelToId('Unknown Label'), 0);
});
