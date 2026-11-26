/** Mitgelieferte Beispiele (eigens für Chromalith erzeugte Motive, frei verwendbar).
 *  Stapel: Filamentname aus der Startbibliothek und Startschicht, ermittelt mit „Filamente vorschlagen“. */
import type { HeightSettings } from "./core";
import stacks from "./examples.json";

export interface Example { id: string; name: string; litho: boolean; stops: [string, number][]; settings: Partial<HeightSettings> }
const S = stacks as unknown as Record<string, { stops: [string, number][]; settings: Partial<HeightSettings> }>;
const relief = (id: string, name: string): Example => ({ id, name, litho: false, stops: S[id]?.stops ?? [], settings: S[id]?.settings ?? {} });
const litho = (id: string, name: string, settings: Partial<HeightSettings> = {}): Example => ({ id, name, litho: true, stops: [], settings: { litho: true, ...settings } });

export const EXAMPLES: Example[] = [
  relief("tiger", "Tiger"), relief("sunset", "Sonnenuntergang"), relief("koi", "Koi und Welle"), relief("astronaut", "Astronaut"),
  relief("fox", "Fuchs"), relief("lighthouse", "Leuchtturm"), relief("hummingbird", "Kolibri"),
  litho("wolf", "Wolf"), litho("owl", "Eule", { litho_form: "sphere", width_mm: 90, litho_img_deg: 140 }),
];
