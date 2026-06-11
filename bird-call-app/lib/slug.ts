// URL slug helpers. We preserve original case and hyphens, and use "_" for the
// space separator — so "Northern Pygmy-Owl" round-trips correctly.
export function slugifySpecies(name: string): string {
  return encodeURIComponent(name.replace(/ /g, "_"));
}

export function unslugifySpecies(slug: string): string {
  return decodeURIComponent(slug).replace(/_/g, " ");
}
