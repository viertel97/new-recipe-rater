import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Strips the Instagram OG prefix "X likes, Y comments - user on date: " and trailing quote
export function cleanInstagramDescription(text: string): string {
  let result = text;
  const quoteStart = result.indexOf(':\u00A0"');
  if (quoteStart === -1) {
    const altStart = result.indexOf(': "');
    if (altStart !== -1 && altStart < 200) {
      result = result.substring(altStart + 3);
    }
  } else {
    result = result.substring(quoteStart + 3);
  }
  return result.replace(/"\.\s*$/, "").trim();
}
