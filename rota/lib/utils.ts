// COPY of HRestroSewa/lib/utils.ts — the Rota app deploys on its own, so it carries its own
// copy. Keep the two in step: a change made in one should be made in the other.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
