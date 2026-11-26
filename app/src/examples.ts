/** Mitgelieferte Beispiele (eigens für Chromalith erzeugte Motive, frei verwendbar).
 *  Stapel: Filamentname aus der Startbibliothek und Startschicht, ermittelt mit „Filamente vorschlagen“. */
import type { HeightSettings } from "./core";
import stacks from "./examples.json";

export interface Example { id: string; name: string; group: string; litho: boolean; stops: [string, number][]; settings: Partial<HeightSettings> }
const S = stacks as unknown as Record<string, { stops: [string, number][]; settings: Partial<HeightSettings> }>;
const relief = (group: string, id: string, name: string): Example => ({ id, name, group, litho: false, stops: S[id]?.stops ?? [], settings: S[id]?.settings ?? {} });
const litho = (group: string, id: string, name: string, settings: Partial<HeightSettings> = {}): Example => ({ id, name, group, litho: true, stops: [], settings: { litho: true, ...settings } });

const A = "Farbreliefs", B = "Lithophanien", C = "Momente", D = "Technik und Neon";
export const EXAMPLES: Example[] = [
  relief(A, "tiger", "Tiger"), relief(A, "sunset", "Sonnenuntergang"), relief(A, "koi", "Koi und Welle"), relief(A, "astronaut", "Astronaut"),
  relief(A, "fox", "Fuchs"), relief(A, "lighthouse", "Leuchtturm"), relief(A, "hummingbird", "Kolibri"), relief(A, "stag", "Hirsch"),
  litho(B, "wolf", "Wolf"), litho(B, "owl", "Eule", { litho_form: "sphere", width_mm: 90, litho_img_deg: 140 }),
  litho(B, "dog", "Hund"), litho(B, "kitten", "Kätzchen"), litho(B, "hands", "Hände"), litho(B, "couple", "Paar am Meer"), litho(B, "childdog", "Beste Freunde"),
  relief(C, "family", "Familie"), relief(C, "balloons", "Heißluftballons"), relief(C, "hearttree", "Herzbaum"),
  relief(D, "circuit", "Leiterbahnen"), relief(D, "neoncity", "Neonstadt"), relief(D, "cyborg", "Cyborg"), relief(D, "retropc", "Retro-Computer"), relief(D, "rider", "Motorrad"),
];
export const EXAMPLE_GROUPS = [A, B, C, D];
