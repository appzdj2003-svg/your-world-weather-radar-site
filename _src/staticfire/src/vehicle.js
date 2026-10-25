// Which vehicle model to draw for a launch. Starship / Super Heavy get the Starship model,
// everything else keeps the existing Falcon 9-style model (unchanged behaviour).
export function isStarship(L) {
  if (!L) return false;
  return /starship|super\s*heavy/i.test(`${L.rocket || ""} ${L.rocketFull || ""} ${L.family || ""}`);
}
export function vehicleKind(L) { return isStarship(L) ? "starship" : "falcon9"; }
