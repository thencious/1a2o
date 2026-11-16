export function networkHue(network: string) {
  const value = network.trim().toLowerCase();
  if (value.includes("whatsapp")) return 135;
  if (value.includes("wechat")) return 105;
  if (value.includes("discord")) return 260;
  if (value.includes("linkedin")) return 220;
  if (value === "x" || value.includes("twitter")) return 207;
  return 45;
}
export function networkName(network: string) {
  const value = network.trim().toLowerCase();
  if (value === "x" || value.includes("twitter")) return "X";
  if (value === "google messages") return "SMS";
  if (value.startsWith("beeper")) return "Beeper";
  return network;
}
export function networkColor(
  network: string,
  saturation: number,
  lightness: number,
) {
  return `hsl(${networkHue(network)} ${networkName(network) === "SMS" ? 0 : saturation}% ${lightness}%)`;
}
