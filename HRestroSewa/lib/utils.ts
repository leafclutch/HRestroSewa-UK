// NOTE: the Rota app (../rota, deployed separately) carries its own COPY of this file.
// Keep the two in step: a change made here should be made there too.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
