export function toOpenWeatherAqi(usAqi) {
  if (usAqi == null || Number.isNaN(usAqi)) return 0;
  if (usAqi <= 50) return 1;
  if (usAqi <= 100) return 2;
  if (usAqi <= 150) return 3;
  if (usAqi <= 200) return 4;
  return 5;
}

export function pickFlightStatus(onGround, positionTs, lastContactTs, nowTs = Math.floor(Date.now() / 1000)) {
  if (onGround === false) return 'in_air';
  if (onGround === true) return 'on_ground';

  const freshest = Math.max(positionTs || 0, lastContactTs || 0);
  if (freshest > 0 && nowTs - freshest < 3600) return 'active';
  return 'scheduled';
}

export function mapGenreLabelToId(label) {
  const key = String(label || '').toLowerCase();
  const genreMap = {
    action: 28,
    adventure: 12,
    animation: 16,
    comedy: 35,
    crime: 80,
    documentary: 99,
    drama: 18,
    family: 10751,
    fantasy: 14,
    history: 36,
    horror: 27,
    music: 10402,
    mystery: 9648,
    romance: 10749,
    thriller: 53,
    war: 10752,
    western: 37,
  };

  return genreMap[key] || 0;
}
