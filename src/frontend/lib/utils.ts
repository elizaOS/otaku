import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Predefined avatars available in the public/avatars folder
const PREDEFINED_AVATARS = [
  '/avatars/user_joyboy.png',
  '/avatars/user_krimson.png',
  '/avatars/user_mati.png',
  '/avatars/user_pek.png',
] as const;

/**
 * Returns a random avatar URL from the predefined avatars
 * @returns A random avatar URL path
 */
export function getRandomAvatar(): string {
  const randomIndex = Math.floor(Math.random() * PREDEFINED_AVATARS.length);
  return PREDEFINED_AVATARS[randomIndex];
}
