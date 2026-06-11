export const CATEGORIES = [
  "Songbirds",
  "Corvids",
  "Hummingbirds",
  "Woodpeckers",
  "Raptors",
  "Waterbirds",
  "Shorebirds",
  "Gulls",
  "Doves",
  "Game birds",
  "Other",
] as const;

export type BirdCategory = (typeof CATEGORIES)[number];

const FAMILY_TO_CATEGORY: Record<string, BirdCategory> = {
  // Corvids
  Corvidae: "Corvids",
  // Hummingbirds
  Trochilidae: "Hummingbirds",
  // Woodpeckers
  Picidae: "Woodpeckers",
  // Raptors
  Accipitridae: "Raptors",
  Falconidae: "Raptors",
  Strigidae: "Raptors",
  Tytonidae: "Raptors",
  Pandionidae: "Raptors",
  Cathartidae: "Raptors",
  // Waterbirds (ducks, geese, herons, grebes, loons, cormorants, pelicans, rails, coots)
  Anatidae: "Waterbirds",
  Ardeidae: "Waterbirds",
  Podicipedidae: "Waterbirds",
  Gaviidae: "Waterbirds",
  Phalacrocoracidae: "Waterbirds",
  Pelecanidae: "Waterbirds",
  Anhingidae: "Waterbirds",
  Rallidae: "Waterbirds",
  Threskiornithidae: "Waterbirds",
  Ciconiidae: "Waterbirds",
  // Shorebirds
  Charadriidae: "Shorebirds",
  Scolopacidae: "Shorebirds",
  Recurvirostridae: "Shorebirds",
  Haematopodidae: "Shorebirds",
  // Gulls and terns
  Laridae: "Gulls",
  Stercorariidae: "Gulls",
  // Doves and pigeons
  Columbidae: "Doves",
  // Game birds
  Phasianidae: "Game birds",
  Odontophoridae: "Game birds",
};

export function deriveCategory(
  family: string | null | undefined,
  order: string | null | undefined,
): BirdCategory {
  if (family && FAMILY_TO_CATEGORY[family]) return FAMILY_TO_CATEGORY[family];
  if (order === "Passeriformes") return "Songbirds";
  return "Other";
}
