import type { PageItems } from "./types.ts";

export type DayType = "weekday" | "saturday" | "holiday" | "special";

export interface Departure {
  time: string;
  note?: string;
}

export interface BusSchedule {
  title: string;
  period?: string;
  directions: {
    from: string;
    to: string;
    columns: { dayType: DayType; label: string; departures: Departure[] }[];
  }[];
  notes: string[];
}

export function parseBusSchedule(_pages: PageItems[]): BusSchedule {
  throw new Error("not implemented");
}

export function nextBuses(
  _s: BusSchedule,
  _q: { from: string; dayType: DayType; now: string; count?: number },
): Departure[] {
  throw new Error("not implemented");
}
